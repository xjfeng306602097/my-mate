// This file is generated from openapi/control-plane.openapi.yaml.
// Run `npm --prefix packages/shared-types run generate:control-plane` to update it.
export type paths = {
    readonly "/api/agents/{profileId}/hosting": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** Update OpenClaw hosting fields for an agent profile */
        readonly put: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly profileId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["UpdateAgentHostingRequest"];
                };
            };
            readonly responses: {
                /** @description Updated agent hosting binding */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly agent_hosting: components["schemas"]["AgentHostingSummary"];
                            readonly profile: components["schemas"]["AgentProfile"];
                        };
                    };
                };
            };
        };
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/agents/hosting": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List OpenClaw agent hosting bindings */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent hosting summary */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentHostingSummary"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/approvals": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List pending approvals */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Approval list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly Record<string, never>[];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/approvals/{approvalId}/approve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Approve request */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly approvalId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CommentRequest"];
                };
            };
            readonly responses: {
                /** @description Approved */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/approvals/{approvalId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject request */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly approvalId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CommentRequest"];
                };
            };
            readonly responses: {
                /** @description Rejected */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/audit-events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List append-only workspace security audit events */
        readonly get: operations["listSecurityAuditEvents"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/auth/me": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return the authenticated principal, selected workspace, and permissions */
        readonly get: operations["getCurrentIdentity"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/dashboard/summary": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Query the indexed runtime dashboard summary */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    /** @description Compare the selected window with the immediately preceding equal-length period. Requires window_hours when set to previous. */
                    readonly compare?: "none" | "previous";
                    readonly correlation_limit?: number;
                    readonly status?: "all" | "active" | "terminal" | "completed" | "failed" | "cancelled";
                    /** @description Optional 1-720 hour runtime overlap window. Omit to preserve legacy all-run reliability aggregation. */
                    readonly window_hours?: number;
                };
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Indexed dashboard summary */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["DashboardSummaryResponse"];
                    };
                };
                /** @description Invalid observability filter */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/diagnostics/doctor": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Probe Control Plane, runtime, Docker Worker, and model readiness */
        readonly post: operations["createDoctorReport"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/human-inputs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List pending human input requests */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Human input list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly Record<string, never>[];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/human-inputs/{inputRequestId}/submit": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Submit human input payload */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly inputRequestId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["HumanInputSubmitRequest"];
                };
            };
            readonly responses: {
                /** @description Submitted */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/internal/ops/execution/dispatch-sweep": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Trigger execution adapter dispatch maintenance sweep */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Maintenance triggered */
                readonly 202: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["ExecutionMaintenanceResult"];
                    };
                };
                /** @description Maintenance unsupported for current adapter */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/mobile/home": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get mobile home overview */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Mobile home payload */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["MobileHomeResponse"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/mobile/inbox": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get mobile inbox items */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Mobile inbox payload */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["MobileInboxItem"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/mobile/runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List mobile run summaries */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Mobile run summaries */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["MobileRunSummary"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/mobile/runs/{runId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get mobile run detail */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Mobile run detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["MobileRunDetail"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/mobile/runs/{runId}/follow-up": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get mobile run follow-up payload */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Mobile run follow-up */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["MobileRunFollowUp"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/planner/candidate-plan": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Generate candidate plan under template constraints */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["PlannerCandidatePlanRequest"];
                };
            };
            readonly responses: {
                /** @description Candidate plan */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["PlannerCandidatePlanResponse"];
                    };
                };
                /** @description Invalid request or planning failed */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Template not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Template not published */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/planner/dag-draft": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Generate an editable DAG draft from intent */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["PlannerDagDraftRequest"];
                };
            };
            readonly responses: {
                /** @description DAG draft */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["PlannerDagDraftResponse"];
                    };
                };
                /** @description Invalid request or draft generation failed */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Template not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Template not published */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/planner/template-selection": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Recommend template for intent */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["PlannerTemplateSelectionRequest"];
                };
            };
            readonly responses: {
                /** @description Recommendation */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["PlannerTemplateSelectionResponse"];
                    };
                };
                /** @description Invalid request */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description No published templates */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/agent-profiles": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List agent profiles */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent profiles */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["AgentProfile"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Upsert agent profile */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["AgentProfile"];
                };
            };
            readonly responses: {
                /** @description Agent profile upserted */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/agent-profiles/{profileId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get agent profile */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly profileId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent profile */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentProfile"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/agent-profiles/{profileId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable agent profile */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly profileId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Disabled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/skills": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List skills */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skills */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["Skill"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Upsert skill */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["Skill"];
                };
            };
            readonly responses: {
                /** @description Skill upserted */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/skills/{skillId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get skill */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly skillId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Skill"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/skills/{skillId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable skill */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly skillId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Disabled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List runs */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly status?: string;
                    readonly template_id?: string;
                };
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Run list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["RunSummary"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create run */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CreateRunRequest"];
                };
            };
            readonly responses: {
                /** @description Created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["CreateRunResponse"];
                    };
                };
                /** @description Template is not published or strict run validation failed */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"] | components["schemas"]["RunValidationFailure"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get run detail */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Run detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["RunDetail"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/actions/cancel": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Cancel run */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Cancelled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/actions/pause": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Pause run */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Paused */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/actions/resume": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Resume run */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Resumed */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/artifacts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get run artifacts */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Artifact list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["Artifact"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/evaluations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List persisted evaluations for a run */
        readonly get: operations["listRunEvaluations"];
        readonly put?: never;
        /** Create or deduplicate an independent run evaluation */
        readonly post: operations["createRunEvaluation"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/evaluations/{evaluationId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get one persisted evaluation */
        readonly get: operations["getRunEvaluation"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get run events */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Event list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["Event"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/nodes/{nodeRunId}/actions/retry": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Retry node */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly nodeRunId: string;
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Retried */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/nodes/{nodeRunId}/actions/skip": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Skip node */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly nodeRunId: string;
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skipped */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/replay-plans": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Generate categorized recommendations without changing runtime configuration */
        readonly post: operations["createRunReplayPlan"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/replay-plans/{replayPlanId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get one persisted replay plan */
        readonly get: operations["getRunReplayPlan"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/replays": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Rebuild runtime state without invoking a provider or Worker */
        readonly post: operations["createRunReplay"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/replays/{replayId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get one persisted replay result */
        readonly get: operations["getRunReplay"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/reruns": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create a linked run from the frozen effective plan */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: {
                    readonly "Idempotency-Key"?: string;
                };
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CreateRerunRequest"];
                };
            };
            readonly responses: {
                /** @description Existing linked rerun returned for the Idempotency-Key */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["CreateRerunResponse"];
                    };
                };
                /** @description Linked rerun created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["CreateRerunResponse"];
                    };
                };
                /** @description Source run is not terminal or the Idempotency-Key conflicts */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/route": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get the immutable canonical route snapshot for a run */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly runId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Canonical route snapshot */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["RunRoute"];
                    };
                };
                /** @description Run route not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/scorecards": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List persisted scorecards for a run */
        readonly get: operations["listRunScorecards"];
        readonly put?: never;
        /** Create or deduplicate a pipeline scorecard for a frozen evidence snapshot */
        readonly post: operations["createRunScorecard"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/scorecards/{scorecardId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get one persisted scorecard */
        readonly get: operations["getRunScorecard"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/supervise": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get bounded runtime deltas after an opaque cursor */
        readonly get: operations["superviseRun"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/trace": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Project a bounded first-class span tree from events and evidence */
        readonly get: operations["getRunTrace"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List session DAG proposals */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description DAG proposal summaries */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly confirmed_proposal_id: string | null;
                            readonly items: readonly components["schemas"]["DagProposalSummary"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create durable DAG proposal for a session */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CreateDagProposalRequest"];
                };
            };
            readonly responses: {
                /** @description DAG proposal created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                            readonly session: Record<string, never>;
                        };
                    };
                };
                /** @description Proposal generation failed */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals/{proposalId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get session DAG proposal */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly proposalId: string;
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description DAG proposal detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals/{proposalId}/assignments": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /** Replace editable DAG proposal assignments */
        readonly patch: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly proposalId: string;
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["UpdateDagProposalAssignmentsRequest"];
                };
            };
            readonly responses: {
                /** @description Assignments updated */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                        };
                    };
                };
            };
        };
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals/{proposalId}/confirm": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Confirm a DAG proposal as the session execution source */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly proposalId: string;
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["ConfirmDagProposalRequest"];
                };
            };
            readonly responses: {
                /** @description Proposal confirmed */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly message: Record<string, never>;
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                            readonly session: Record<string, never>;
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals/{proposalId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject a DAG proposal */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly proposalId: string;
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["RejectDagProposalRequest"];
                };
            };
            readonly responses: {
                /** @description Proposal rejected */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/dag-proposals/{proposalId}/supersede": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Supersede a DAG proposal with a newer proposal */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly proposalId: string;
                    readonly sessionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["SupersedeDagProposalRequest"];
                };
            };
            readonly responses: {
                /** @description Replacement proposal created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly proposal: components["schemas"]["DagProposalRecord"];
                            readonly session?: Record<string, never>;
                            readonly superseded_proposal: components["schemas"]["DagProposalRecord"];
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List templates */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Template list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["TemplateSummary"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create template */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CreateTemplateRequest"];
                };
            };
            readonly responses: {
                /** @description Created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["TemplateSummary"];
                    };
                };
                /** @description Error */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get template detail */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Template detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": Record<string, never>;
                    };
                };
            };
        };
        /** Update template draft */
        readonly put: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": Record<string, never>;
                };
            };
            readonly responses: {
                /** @description Updated */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": Record<string, never>;
                    };
                };
            };
        };
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}/archive": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Archive template */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Archived */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["PublishTemplateResponse"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}/derive": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Derive a new draft template from source */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["DeriveTemplateRequest"];
                };
            };
            readonly responses: {
                /** @description Draft derived */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}/lineage": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get template lineage */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Lineage */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["TemplateLineageResponse"];
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}/new-version": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create next-version draft from a published template */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["DeriveTemplateRequest"];
                };
            };
            readonly responses: {
                /** @description Version draft created */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/templates/{templateId}/publish": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Publish template version */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly templateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Published */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["PublishTemplateResponse"];
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/workspaces": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List workspaces available to the authenticated principal */
        readonly get: operations["listWorkspaces"];
        readonly put?: never;
        /** Create a workspace and owner membership */
        readonly post: operations["createWorkspace"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/workspaces/{workspaceId}/members": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listWorkspaceMembers"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/workspaces/{workspaceId}/members/{principalId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put: operations["updateWorkspaceMember"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        readonly AgentHostingSummary: {
            readonly ownership: {
                /** @enum {string} */
                readonly execution_runtime: "openclaw";
                /** @enum {string} */
                readonly orchestration_binding: "my_mate";
            };
            readonly profiles: readonly {
                readonly default_skills: readonly string[];
                readonly health: {
                    readonly detail: string;
                    /** @enum {string} */
                    readonly status: "ready" | "needs_binding" | "disabled";
                };
                /** @enum {string} */
                readonly managed_by: "my_mate_registry";
                readonly model?: string | null;
                readonly name: string;
                readonly openclaw_agent_id: string;
                readonly profile_id: string;
                readonly provider?: string | null;
                readonly runtime_mode?: string | null;
                /** @enum {string} */
                readonly status: "active" | "disabled";
            }[];
        };
        readonly AgentProfile: {
            readonly allowed_tools: readonly string[];
            readonly default_skills: readonly string[];
            readonly disallowed_skills?: readonly string[];
            readonly metadata?: Record<string, never>;
            readonly name: string;
            readonly openclaw_agent_id: string;
            readonly policy_tags?: readonly string[];
            readonly profile_id: string;
            /** @enum {string} */
            readonly status: "active" | "disabled";
        };
        readonly ApprovalRecord: {
            readonly approval_id: string;
            readonly kind: string;
            readonly node_run_id: string | null;
            /** Format: date-time */
            readonly requested_at: string;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly run_id: string;
            /** @enum {string} */
            readonly status: "pending" | "approved" | "rejected" | "cancelled";
            readonly summary: string;
        };
        readonly Artifact: {
            readonly artifact_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly mime_type: string;
            readonly name: string;
            readonly node_run_id: string | null;
            readonly run_id: string;
            readonly size_bytes: number;
            readonly storage_uri: string;
            readonly type: string;
        };
        readonly AuthenticatedPrincipal: {
            readonly display_name: string;
            readonly principal_id: string;
            /** @enum {string} */
            readonly principal_type: "user" | "service" | "development";
        };
        readonly AuthMeResponse: {
            /** @enum {string} */
            readonly auth_method: "bearer" | "development";
            readonly available_workspaces: readonly components["schemas"]["WorkspaceMembership"][];
            /** Format: date-time */
            readonly issued_at: string;
            readonly memberships: readonly components["schemas"]["WorkspaceMembership"][];
            readonly permissions: readonly components["schemas"]["WorkspacePermission"][];
            readonly principal: components["schemas"]["AuthenticatedPrincipal"];
            readonly request_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly selected_workspace: components["schemas"]["WorkspaceMembership"];
        };
        readonly CommentRequest: {
            readonly comment: string;
        };
        readonly ConfirmDagProposalRequest: {
            readonly confirmed_by?: string;
        };
        readonly ConfirmDagProposalResponse: {
            readonly message: Record<string, never>;
            readonly proposal: components["schemas"]["DagProposalRecord"];
            readonly session: Record<string, never>;
        };
        readonly CreateDagProposalRequest: {
            readonly inputs?: Record<string, never>;
            readonly source_message_id?: string;
            /** @enum {string} */
            readonly source_option?: "primary" | "alternative";
            readonly source_revision?: number;
            readonly template_id?: string;
        };
        readonly CreateDagProposalResponse: {
            readonly proposal: components["schemas"]["DagProposalRecord"];
            readonly session: Record<string, never>;
        };
        readonly CreateEvaluationRequest: {
            /** @default false */
            readonly allow_incomplete?: boolean;
            /**
             * @description none, deterministic-v1, model-v1, or another registered evaluator id
             * @default none
             */
            readonly evaluator?: string;
        };
        readonly CreateReplayPlanRequest: {
            readonly evaluation_id?: string;
            readonly scorecard_id?: string;
        };
        readonly CreateRerunRequest: {
            readonly input_overrides?: Record<string, never>;
            readonly reason: string;
        };
        readonly CreateRerunResponse: {
            readonly rerun_idempotency_key: string | null;
            readonly rerun_reason: string;
            readonly route: components["schemas"]["RunRoute"];
            readonly run_id: string;
            readonly source_run_id: string;
            readonly status: string;
        };
        readonly CreateRunRequest: {
            readonly inputs: Record<string, never>;
            readonly intent: string;
            /** @description Optional durable DAG proposal id that sourced the run for lineage. */
            readonly proposal_id?: string;
            readonly template_id: string;
            /**
             * @description warn runs validation and returns warnings without blocking. strict blocks run creation when validation fails. bypass skips the gate.
             * @default strict
             * @enum {string}
             */
            readonly validation_mode?: "warn" | "strict" | "bypass";
        };
        readonly CreateRunResponse: {
            readonly route: components["schemas"]["RunRoute"];
            readonly run_id: string;
            readonly status: string;
            readonly validation: components["schemas"]["PlannerValidationResult"];
        };
        readonly CreateScorecardRequest: {
            /** @default false */
            readonly allow_incomplete?: boolean;
            /** @default pipeline-v1 */
            readonly profile?: string;
        };
        readonly CreateTemplateRequest: {
            readonly description: string;
            readonly edges: readonly Record<string, never>[];
            readonly input_schema: Record<string, never>;
            readonly name: string;
            readonly nodes: readonly Record<string, never>[];
            readonly policy: Record<string, never>;
        };
        readonly CreateWorkspaceRequest: {
            readonly name: string;
            readonly workspace_id: string;
        };
        readonly DagProposalAssignment: {
            readonly allowed_skills: readonly string[];
            readonly allowed_tools: readonly string[];
            readonly input_context: string | null;
            readonly metadata: Record<string, never>;
            readonly model: string | null;
            readonly node_id: string;
            readonly node_name: string | null;
            readonly output_contract: string | null;
            readonly provider: string | null;
            readonly subagent_profile_id: string | null;
        };
        readonly DagProposalPlannerContext: {
            readonly fallback_reason: string | null;
            readonly fallback_used: boolean;
            readonly model: string | null;
            readonly orchestrator_profile_id: string | null;
            readonly provider_id: string | null;
            readonly system_prompt_summary: string | null;
        };
        readonly DagProposalRecord: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
            readonly checklist: readonly string[];
            /** Format: date-time */
            readonly confirmed_at: string | null;
            readonly confirmed_by: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly dag_draft: Record<string, never>;
            readonly metadata: Record<string, never>;
            readonly mission_id: string;
            readonly mission_spec_contract: Record<string, never> | null;
            readonly orchestrator_profile_id: string | null;
            readonly planner_context: components["schemas"]["DagProposalPlannerContext"];
            readonly proposal_id: string;
            /** Format: date-time */
            readonly rejected_at: string | null;
            readonly rejected_by: string | null;
            readonly route_compare: Record<string, never> | null;
            readonly session_id: string;
            readonly source_message_id: string | null;
            /** @enum {string|null} */
            readonly source_option: "primary" | "alternative" | null;
            readonly source_revision: number | null;
            readonly status: components["schemas"]["DagProposalStatus"];
            readonly summary: string;
            /** Format: date-time */
            readonly superseded_at: string | null;
            readonly superseded_by_proposal_id: string | null;
            readonly supersedes_proposal_id: string | null;
            readonly title: string;
            /** Format: date-time */
            readonly updated_at: string;
            readonly warnings: readonly string[];
        };
        readonly DagProposalResponse: {
            readonly proposal: components["schemas"]["DagProposalRecord"];
        };
        /** @enum {string} */
        readonly DagProposalStatus: "draft" | "review_ready" | "confirmed" | "rejected" | "superseded";
        readonly DagProposalSummary: {
            /** Format: date-time */
            readonly created_at: string;
            readonly mission_id: string;
            readonly proposal_id: string;
            readonly session_id: string;
            /** @enum {string|null} */
            readonly source_option: "primary" | "alternative" | null;
            readonly source_revision: number | null;
            readonly status: components["schemas"]["DagProposalStatus"];
            readonly summary: string;
            readonly title: string;
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly DashboardComparisonMetric: {
            readonly change_rate: number | null;
            readonly current: number | null;
            readonly delta: number | null;
            /** @enum {string} */
            readonly direction: "up" | "down" | "flat" | "unavailable";
            /** @enum {string} */
            readonly outcome: "improved" | "regressed" | "neutral" | "unavailable";
            readonly previous: number | null;
        };
        readonly DashboardObservabilityComparison: {
            /** @enum {string} */
            readonly coverage: "complete" | "partial";
            readonly metrics: {
                readonly job_p95_ms: components["schemas"]["DashboardComparisonMetric"];
                readonly job_success_rate: components["schemas"]["DashboardComparisonMetric"];
                readonly retry_rate: components["schemas"]["DashboardComparisonMetric"];
                readonly run_p95_ms: components["schemas"]["DashboardComparisonMetric"];
                readonly run_success_rate: components["schemas"]["DashboardComparisonMetric"];
                readonly runs_observed: components["schemas"]["DashboardComparisonMetric"];
                readonly total_tokens: components["schemas"]["DashboardComparisonMetric"];
            };
            /** @constant */
            readonly mode: "previous_period";
            readonly previous_window: {
                /** Format: date-time */
                readonly ended_at: string;
                /** Format: date-time */
                readonly started_at: string;
            };
        } | null;
        readonly DashboardObservabilityQuery: {
            /** @enum {string} */
            readonly compare: "none" | "previous";
            readonly correlation_limit: number;
            /** @constant */
            readonly index_schema_version: 1;
            readonly indexed_runs: number;
            readonly rebuilt_runs: number;
            /** @enum {string} */
            readonly status: "all" | "active" | "terminal" | "completed" | "failed" | "cancelled";
            /** @description Null preserves the legacy all-run reliability scope; supplied values filter indexed runs by overlapping runtime window. */
            readonly window_hours: number | null;
        };
        readonly DashboardObservabilityRetention: {
            readonly applied: boolean;
            /** @constant */
            readonly canonical_data_retained: true;
            /** Format: date-time */
            readonly cutoff_at: string | null;
            readonly enabled: boolean;
            readonly excluded_runs: number;
            readonly pruned_dirty_markers: number;
            readonly pruned_indexes: number;
            readonly retained_runs: number;
            readonly retention_hours: number | null;
        };
        readonly DashboardSummaryResponse: {
            readonly backlog: {
                readonly [key: string]: unknown;
            };
            /** Format: date-time */
            readonly generated_at: string;
            readonly hotspots: {
                readonly [key: string]: unknown;
            };
            readonly observability: {
                readonly activity: readonly {
                    readonly [key: string]: unknown;
                }[];
                readonly comparison: components["schemas"]["DashboardObservabilityComparison"];
                readonly correlations: readonly {
                    readonly [key: string]: unknown;
                }[];
                readonly latency: {
                    readonly [key: string]: unknown;
                };
                readonly query: components["schemas"]["DashboardObservabilityQuery"];
                readonly reliability: {
                    readonly [key: string]: unknown;
                };
                readonly retention: components["schemas"]["DashboardObservabilityRetention"];
                readonly usage: {
                    readonly [key: string]: unknown;
                };
                readonly window: {
                    readonly [key: string]: unknown;
                };
            };
            readonly runtime_health: {
                readonly [key: string]: unknown;
            };
            readonly workload: {
                readonly [key: string]: unknown;
            };
        };
        readonly DeriveTemplateRequest: {
            readonly description?: string;
            readonly metadata?: Record<string, never>;
            readonly name?: string;
            readonly template_id?: string;
        };
        readonly DoctorCheck: {
            /** @enum {string} */
            readonly category: "control_plane" | "storage" | "runtime" | "docker" | "worker" | "workspace" | "harness" | "provider";
            readonly detail: string | null;
            readonly duration_ms: number;
            readonly id: string;
            readonly remediation: string | null;
            readonly required_for: readonly ("runtime" | "deterministic" | "model")[];
            /** @enum {string} */
            readonly status: "pass" | "warn" | "fail" | "skipped";
            readonly summary: string;
        };
        readonly DoctorReport: {
            readonly checks: readonly components["schemas"]["DoctorCheck"][];
            readonly deterministic_ready: boolean;
            /** Format: date-time */
            readonly generated_at: string;
            readonly model_ready: boolean;
            readonly model_verified: boolean | null;
            readonly report_id: string;
            readonly runtime_dispatcher: string;
            readonly runtime_ready: boolean;
            /** @constant */
            readonly schema_version: 1;
            readonly storage_backend: string;
        };
        readonly DoctorRequest: {
            /**
             * @default quick
             * @enum {string}
             */
            readonly mode?: "quick" | "docker" | "model";
            /** @default false */
            readonly model_probe?: boolean;
            /** @enum {string} */
            readonly runtime?: "local" | "docker-worker" | "openclaw" | "codex" | "claude-sdk" | "kimi";
        };
        readonly Error: {
            readonly code: string;
            readonly message: string;
        };
        readonly EvaluationFinding: components["schemas"]["ScorecardFinding"] & {
            /** @enum {string} */
            readonly dimension: "pipeline" | "contract" | "evidence" | "usage" | "quality";
        };
        readonly EvaluationResult: {
            readonly attempt: number;
            /** Format: date-time */
            readonly completed_at: string | null;
            /** @enum {string} */
            readonly contract_verdict: "pass" | "fail" | "not_applicable" | "incomplete";
            /** Format: date-time */
            readonly created_at: string;
            readonly error: string | null;
            readonly evaluation_id: string;
            readonly evaluator: components["schemas"]["EvaluatorDescriptor"];
            readonly evaluator_usage: components["schemas"]["UsageSummary"] | null;
            readonly evidence_digest: string;
            /** @enum {string} */
            readonly evidence_verdict: "complete" | "partial" | "unavailable";
            readonly findings: readonly components["schemas"]["EvaluationFinding"][];
            /** @enum {string} */
            readonly gate_verdict: "pass" | "reject" | "not_enforced";
            /** @enum {string} */
            readonly pipeline_verdict: "pass" | "fail" | "incomplete";
            /** @enum {string} */
            readonly quality_verdict: "pass" | "fail" | "not_evaluated" | "error";
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly scorecard_id: string;
            readonly snapshot_id: string;
            /** Format: date-time */
            readonly started_at: string | null;
            /** @enum {string} */
            readonly status: "queued" | "running" | "completed" | "failed";
            /** @enum {string} */
            readonly usage_verdict: "complete" | "partial" | "unavailable";
        };
        readonly EvaluatorDescriptor: {
            readonly id: string;
            /** @enum {string} */
            readonly kind: "none" | "deterministic" | "model";
            readonly model: string | null;
            readonly prompt_version: string | null;
            readonly provider: string | null;
            readonly version: string;
        };
        readonly Event: {
            readonly actor_id: string;
            readonly actor_type: string;
            readonly causation_id?: string | null;
            readonly correlation_id?: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly event_id: string;
            readonly idempotency_key?: string | null;
            readonly node_run_id: string | null;
            readonly payload: Record<string, never>;
            readonly run_id: string;
            readonly run_sequence?: number;
            /** @enum {integer} */
            readonly schema_version?: 2;
            readonly type: string;
        };
        readonly ExecutionMaintenanceResult: {
            /** @enum {string} */
            readonly action: "dispatch_sweep";
            readonly adapter_kind: string;
            readonly message: string | null;
            readonly summary: {
                readonly aligned: number;
                readonly finalized: number;
                readonly normalized: number;
                readonly resumed: number;
                readonly scanned: number;
            } | null;
            readonly supported: boolean;
        };
        readonly HumanInputRecord: {
            readonly input_request_id: string;
            readonly input_schema: {
                readonly [key: string]: unknown;
            };
            readonly node_run_id: string | null;
            /** Format: date-time */
            readonly requested_at: string;
            readonly run_id: string;
            /** @enum {string} */
            readonly status: "pending" | "submitted" | "expired" | "cancelled";
            /** Format: date-time */
            readonly submitted_at: string | null;
            readonly summary: string;
        };
        readonly HumanInputSubmitRequest: {
            readonly payload: Record<string, never>;
        };
        readonly LegacyConfirmDagProposalRequest: {
            readonly confirmed_by?: string;
        };
        readonly LegacyCreateDagProposalRequest: {
            readonly inputs?: Record<string, never>;
            readonly source_message_id?: string;
            /** @enum {string} */
            readonly source_option?: "primary" | "alternative";
            readonly source_revision?: number;
            readonly template_id?: string;
        };
        readonly LegacyDagProposalAssignment: {
            readonly allowed_skills: readonly string[];
            readonly allowed_tools: readonly string[];
            readonly input_context: string | null;
            readonly metadata: Record<string, never>;
            readonly model: string | null;
            readonly node_id: string;
            readonly node_name: string | null;
            readonly output_contract: string | null;
            readonly provider: string | null;
            readonly subagent_profile_id: string | null;
        };
        readonly LegacyDagProposalPlannerContext: {
            readonly fallback_reason: string | null;
            readonly fallback_used: boolean;
            readonly model: string | null;
            readonly orchestrator_profile_id: string | null;
            readonly provider_id: string | null;
            readonly system_prompt_summary: string | null;
        };
        readonly LegacyDagProposalRecord: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
            readonly checklist: readonly string[];
            readonly dag_draft: Record<string, never>;
            readonly metadata: Record<string, never>;
            readonly mission_id: string;
            readonly mission_spec_contract?: Record<string, never> | null;
            readonly orchestrator_profile_id?: string | null;
            readonly planner_context: components["schemas"]["DagProposalPlannerContext"];
            readonly proposal_id: string;
            readonly route_compare?: Record<string, never> | null;
            readonly session_id: string;
            readonly source_message_id?: string | null;
            /** @enum {string|null} */
            readonly source_option?: "primary" | "alternative" | null;
            readonly source_revision?: number | null;
            /** @enum {string} */
            readonly status: "draft" | "review_ready" | "confirmed" | "rejected" | "superseded";
            readonly summary: string;
            readonly title: string;
            readonly warnings: readonly string[];
        };
        readonly LegacyDagProposalSummary: {
            readonly created_at: string;
            readonly mission_id: string;
            readonly proposal_id: string;
            readonly session_id: string;
            /** @enum {string|null} */
            readonly source_option?: "primary" | "alternative" | null;
            readonly source_revision?: number | null;
            /** @enum {string} */
            readonly status: "draft" | "review_ready" | "confirmed" | "rejected" | "superseded";
            readonly summary: string;
            readonly title: string;
            readonly updated_at: string;
        };
        readonly LegacyRejectDagProposalRequest: {
            readonly reason?: string;
            readonly rejected_by?: string;
        };
        readonly LegacySupersedeDagProposalRequest: {
            readonly inputs?: Record<string, never>;
            readonly reason?: string;
            readonly source_message_id?: string;
            readonly template_id?: string;
        };
        readonly LegacyUpdateDagProposalAssignmentsRequest: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
        };
        readonly ListDagProposalsResponse: {
            readonly confirmed_proposal_id: string | null;
            readonly items: readonly components["schemas"]["DagProposalSummary"][];
        };
        readonly MobileHomeResponse: {
            readonly focus_run: components["schemas"]["MobileRunSummary"] | null;
            readonly inbox: Record<string, never>;
            readonly overview: Record<string, never>;
            readonly recent_runs: readonly components["schemas"]["MobileRunSummary"][];
        };
        readonly MobileInboxItem: {
            readonly intent: string;
            /** @enum {string} */
            readonly kind: "approval" | "human_input";
            readonly next_actions: readonly string[];
            readonly node_run_id: string | null;
            readonly request_id: string;
            /** Format: date-time */
            readonly requested_at: string;
            readonly run_id: string;
            readonly run_status: string;
            readonly summary: string;
            readonly task: components["schemas"]["MobileTask"] | null;
        };
        readonly MobileRunDetail: {
            readonly artifacts: readonly components["schemas"]["Artifact"][];
            readonly next_actions: readonly string[];
            readonly pending_approvals: readonly Record<string, never>[];
            readonly pending_human_inputs: readonly Record<string, never>[];
            readonly run: components["schemas"]["RunDetail"];
            readonly tasks: readonly components["schemas"]["MobileTask"][];
            readonly timeline: readonly components["schemas"]["Event"][];
        };
        readonly MobileRunFollowUp: {
            readonly active_task: components["schemas"]["MobileTask"] | null;
            readonly artifact_count: number;
            readonly artifacts: readonly components["schemas"]["Artifact"][];
            readonly blocker: string | null;
            readonly latest_timeline: readonly components["schemas"]["Event"][];
            readonly next_actions: readonly string[];
            readonly pending_approvals: readonly Record<string, never>[];
            readonly pending_human_inputs: readonly Record<string, never>[];
            readonly run: components["schemas"]["RunDetail"];
        };
        readonly MobileRunSummary: {
            readonly active_task: components["schemas"]["MobileTask"] | null;
            readonly artifact_count: number;
            readonly current_summary: string;
            readonly intent: string;
            readonly next_actions: readonly string[];
            readonly pending_approval_count: number;
            readonly pending_human_input_count: number;
            readonly run_id: string;
            readonly status: string;
            readonly template_id: string;
            readonly template_version: number;
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly MobileTask: {
            readonly attempt: number;
            readonly execution_ref: Record<string, never>;
            readonly finished_at: string | null;
            readonly name: string;
            readonly node_id: string;
            readonly node_run_id: string;
            readonly openclaw_agent_id: string | null;
            readonly progress: Record<string, never>;
            readonly registry_provenance: components["schemas"]["RegistryProvenance"];
            readonly started_at: string | null;
            readonly status: string;
            readonly type: string;
        };
        readonly NodeHandoffRecord: {
            readonly content: unknown;
            readonly content_ref?: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly handoff_id: string;
            readonly job_id: string;
            readonly node_id: string;
            readonly node_run_id: string;
            readonly port: string;
            readonly routed_node_run_ids: readonly string[];
            readonly run_id: string;
            readonly skipped_node_run_ids: readonly string[];
            readonly summary: string | null;
            /** @constant */
            readonly type: "node_handoff";
        };
        readonly PlannerCandidatePlanRequest: {
            readonly inputs: Record<string, never>;
            readonly intent: string;
            readonly template_id: string;
        };
        readonly PlannerCandidatePlanResponse: {
            /** @description Draft RunPlan preview. Its planner_context.registry_validation follows PlannerRegistryValidation when present. */
            readonly candidate_plan: Record<string, never>;
            readonly validation: components["schemas"]["PlannerValidationResult"];
        };
        readonly PlannerDagDraftRequest: {
            readonly inputs?: Record<string, never>;
            readonly intent: string;
            /** @default 1 */
            readonly max_agent_nodes?: number;
            /** @description Optional published template to use as the draft source. */
            readonly template_id?: string;
        };
        readonly PlannerDagDraftResponse: {
            /** @description Draft template payload. It is not persisted until POST /api/templates. */
            readonly draft_template: components["schemas"]["CreateTemplateRequest"] & {
                readonly template_id: string;
            };
            readonly planner_context: {
                /** @enum {string} */
                readonly draft_strategy: "template_variant" | "registry_synthesis";
                readonly human_confirmation_required: boolean;
                readonly intent_tokens: readonly string[];
                /** @enum {string} */
                readonly planner_model: "rule_based_v1";
                readonly source_template_id: string | null;
            };
            readonly registry_recommendations: readonly components["schemas"]["PlannerRegistryRecommendation"][];
            readonly template_recommendation: components["schemas"]["PlannerTemplateSelectionResponse"] | null;
            readonly validation: components["schemas"]["PlannerValidationResult"];
        };
        readonly PlannerRegistryRecommendation: {
            readonly agent_profile_id: string | null;
            readonly agent_profile_name: string | null;
            readonly node_id: string;
            readonly node_name: string;
            readonly openclaw_agent_id: string | null;
            readonly reason: string;
            readonly score: number;
            readonly skill_ids: readonly string[];
            readonly warnings: readonly string[];
        };
        readonly PlannerRegistryValidation: {
            readonly disabled_agent_profile_count?: number;
            readonly disabled_skill_count?: number;
            readonly disallowed_skill_count?: number;
            readonly executable_node_count?: number;
            readonly missing_agent_profile_count?: number;
            readonly missing_openclaw_agent_count?: number;
            readonly missing_skill_count?: number;
            readonly registry_bound_node_count?: number;
            readonly registry_bound_skill_count?: number;
            readonly skill_reference_count?: number;
        };
        readonly PlannerTemplateCandidate: {
            readonly description: string;
            readonly matched_terms: readonly string[];
            readonly name: string;
            readonly reason: string;
            readonly score: number;
            readonly template_id: string;
            readonly version: number;
            readonly workspace_scope: string;
        };
        readonly PlannerTemplateSelectionRequest: {
            readonly intent: string;
        };
        readonly PlannerTemplateSelectionResponse: {
            readonly candidates: readonly components["schemas"]["PlannerTemplateCandidate"][];
            readonly planner_context: {
                readonly intent_tokens: readonly string[];
                /** @enum {string} */
                readonly planner_model: "rule_based_v1";
            };
            readonly selected_template: components["schemas"]["PlannerTemplateCandidate"];
        };
        readonly PlannerValidationResult: {
            readonly details: readonly {
                readonly agent_profile_id: string | null;
                /** @enum {string} */
                readonly category: "required_input" | "registry" | "graph" | "other";
                /** @enum {string} */
                readonly code: "missing_required_input" | "missing_agent_profile" | "missing_openclaw_agent" | "unknown_agent_profile" | "disabled_agent_profile" | "unknown_skill" | "disabled_skill" | "disallowed_skill" | "no_ready_frontier" | "no_terminal_node";
                readonly field: string | null;
                readonly message: string;
                readonly node_id: string | null;
                readonly node_name: string | null;
                readonly skill_id: string | null;
            }[];
            readonly passed: boolean;
            /** @description Validation warnings. Includes required-input/DAG checks plus registry readiness checks for unknown or disabled agent profiles, unknown or disabled skills, profile-disallowed skills, and missing OpenClaw agent bindings. */
            readonly warnings: readonly string[];
        };
        readonly PublishTemplateResponse: {
            readonly status: string;
            readonly template_id: string;
            readonly version: number;
        };
        readonly RegistryProvenance: {
            readonly agent_profile_requested: string | null;
            readonly agent_profile_resolved: string | null;
            /** @enum {string} */
            readonly agent_profile_source: "registry" | "template_binding" | "fallback" | "none";
            /** @enum {string|null} */
            readonly agent_profile_status: "active" | "disabled" | "missing" | null;
            /** @enum {string} */
            readonly openclaw_agent_id_source: "registry" | "template_binding" | "fallback" | "none";
            readonly skill_bindings: readonly {
                /** @enum {string|null} */
                readonly excluded_reason: "disallowed_by_agent_profile" | "disabled" | "missing" | null;
                readonly included: boolean;
                /** @enum {string} */
                readonly registry_status: "active" | "disabled" | "missing";
                readonly skill_id: string;
                readonly sources: readonly ("agent_profile_default" | "node_allowed")[];
            }[];
            readonly tool_bindings: readonly {
                readonly sources: readonly ("agent_profile_allowed" | "node_allowed")[];
                readonly tool_id: string;
            }[];
        };
        readonly RejectDagProposalRequest: {
            readonly reason?: string;
            readonly rejected_by?: string;
        };
        readonly ReplayDifference: {
            /** @enum {string} */
            readonly category: "run" | "plan" | "node" | "job" | "worker" | "lease" | "handoff" | "artifact" | "evidence" | "gate" | "runtime_patch";
            readonly field: string;
            readonly persisted: unknown;
            readonly record_id: string;
            readonly replayed: unknown;
            /** @enum {string} */
            readonly severity: "error" | "warning";
            readonly summary: string;
        };
        readonly ReplayPlanRecommendation: {
            /** @enum {string} */
            readonly category: "runtime_environment" | "scheduler_dispatch" | "provider_harness" | "prompt_agent_assignment" | "handoff_contract" | "artifact_contract" | "evidence_completeness" | "policy_evaluator" | "human_gate" | "budget_usage";
            readonly change_target: string;
            /** @enum {string} */
            readonly priority: "high" | "medium" | "low";
            readonly rationale: string;
            readonly recommendation_id: string;
            readonly references: readonly string[];
            readonly summary: string;
        };
        readonly ReplayPlanResult: {
            /** Format: date-time */
            readonly created_at: string;
            readonly evaluation_id: string | null;
            readonly recommendations: readonly components["schemas"]["ReplayPlanRecommendation"][];
            readonly replay_id: string;
            readonly replay_plan_id: string;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly scorecard_id: string | null;
            readonly summary: string;
            /** @enum {string} */
            readonly trace_completeness: "complete" | "legacy_partial";
        };
        readonly ReplayResult: {
            /** Format: date-time */
            readonly created_at: string;
            /** @enum {string} */
            readonly event_completeness: "complete" | "legacy_partial";
            readonly event_digest: string;
            readonly first_sequence: number | null;
            readonly last_sequence: number | null;
            readonly missing_references: readonly string[];
            readonly processed_events: number;
            readonly projection_differences: readonly components["schemas"]["ReplayDifference"][];
            readonly replay_id: string;
            readonly route_id: string;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            /** @enum {string} */
            readonly verification: "pass" | "fail" | "partial";
        };
        readonly RunDetail: {
            readonly blocked_reason: string | null;
            readonly current_summary: string;
            readonly intent: string;
            readonly proposal_id: string | null;
            readonly requested_by: string;
            readonly rerun_idempotency_key?: string | null;
            readonly rerun_reason?: string | null;
            readonly route?: components["schemas"]["RunRoute"] | null;
            readonly run_id: string;
            readonly source_run_id?: string | null;
            readonly status: string;
            readonly template_id: string;
            readonly template_version: number;
            readonly waiting_reason: string | null;
            readonly workspace_id: string;
        };
        readonly RunRoute: {
            /** Format: date-time */
            readonly created_at: string;
            readonly edge_count: number;
            readonly node_count: number;
            /** @enum {string|null} */
            readonly plan_option: "primary" | "alternative" | null;
            readonly plan_revision: number | null;
            readonly proposal_id: string | null;
            readonly route_id: string;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string | null;
            /** @enum {string} */
            readonly source_kind: "session_plan" | "proposal" | "direct_template" | "rerun" | "legacy";
            readonly source_run_id: string | null;
            readonly template_id: string;
            readonly template_name: string;
            readonly template_version: number;
            readonly work_packages: readonly {
                /** @enum {string} */
                readonly identity_source: "declared" | "compiler_default" | "legacy_inferred";
                readonly key: string;
                readonly label: string;
                readonly node_run_ids: readonly string[];
                readonly order: number;
            }[];
        };
        readonly RunSummary: {
            readonly current_summary: string;
            readonly proposal_id?: string | null;
            readonly rerun_idempotency_key?: string | null;
            readonly rerun_reason?: string | null;
            readonly route?: components["schemas"]["RunRoute"] | null;
            readonly run_id: string;
            readonly source_run_id?: string | null;
            readonly status: string;
            readonly template_id: string;
        };
        readonly RuntimeGraphNode: {
            readonly agentProfile: string | null;
            readonly approvalKind: string | null;
            readonly attempt: number;
            readonly expectedArtifacts: readonly string[];
            /** Format: date-time */
            readonly finishedAt: string | null;
            readonly humanInputRequired: boolean;
            readonly markers: readonly ("active_frontier" | "waiting_human" | "approval_gate" | "human_input_gate" | "blocked" | "skipped" | "terminal" | "ready")[];
            readonly name: string;
            readonly nodeId: string;
            readonly nodeRunId: string;
            readonly openclawAgentId: string | null;
            readonly progress: {
                readonly message: string;
                readonly percent: number;
                /** Format: date-time */
                readonly updated_at: string;
            };
            readonly runtimeAgentRef: string | null;
            /** Format: date-time */
            readonly startedAt: string | null;
            /** @enum {string} */
            readonly status: "pending" | "ready" | "running" | "waiting_human" | "completed" | "failed" | "skipped" | "cancelled";
            readonly type: string;
            /** @enum {string} */
            readonly workPackageIdentitySource: "declared" | "compiler_default" | "legacy_inferred";
            readonly workPackageKey: string;
            readonly workPackageLabel: string;
            readonly workPackageOrder: number;
        };
        readonly RunValidationFailure: components["schemas"]["Error"] & {
            readonly validation: components["schemas"]["PlannerValidationResult"];
        };
        readonly ScorecardFinding: {
            readonly check_id: string;
            readonly detail: string;
            readonly evidence_refs: readonly string[];
            readonly passed: boolean;
            /** @enum {string} */
            readonly severity: "error" | "warning" | "blind_spot" | "info";
            readonly summary: string;
        };
        readonly ScorecardResult: {
            readonly blind_spot_count: number;
            /** @enum {string} */
            readonly contract_verdict: "pass" | "fail" | "not_applicable" | "incomplete";
            /** Format: date-time */
            readonly created_at: string;
            /** @enum {string} */
            readonly enforcement: "off" | "advisory" | "strict";
            readonly evidence_digest: string;
            readonly findings: readonly components["schemas"]["ScorecardFinding"][];
            /** @enum {string} */
            readonly gate_verdict: "pass" | "reject" | "not_enforced";
            readonly hard_error_count: number;
            readonly passed_checks: number;
            /** @enum {string} */
            readonly pipeline_verdict: "pass" | "fail" | "incomplete";
            readonly policy_version: number;
            readonly profile: string;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly scorecard_id: string;
            readonly snapshot_id: string;
            readonly total_checks: number;
            readonly warning_count: number;
        };
        readonly SecurityAuditEvent: {
            readonly action: string;
            readonly audit_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly hash: string;
            readonly metadata: {
                readonly [key: string]: string | number | boolean | null;
            };
            readonly method: string;
            /** @enum {string} */
            readonly outcome: "allowed" | "denied" | "error";
            readonly path: string;
            readonly permission: components["schemas"]["WorkspacePermission"] | null;
            readonly previous_hash: string | null;
            readonly principal_id: string;
            /** @enum {string} */
            readonly principal_type: "user" | "service" | "development" | "unknown";
            readonly request_id: string;
            readonly resource_id: string | null;
            readonly resource_type: string | null;
            /** @constant */
            readonly schema_version: 1;
            readonly status_code: number;
            readonly workspace_id: string;
        };
        readonly Skill: {
            readonly allowed_tools: readonly string[];
            readonly category: string;
            readonly name: string;
            readonly skill_id: string;
            /** @enum {string} */
            readonly status: "active" | "disabled";
        };
        readonly SupersedeDagProposalRequest: {
            readonly inputs?: Record<string, never>;
            readonly reason?: string;
            readonly source_message_id?: string;
            readonly template_id?: string;
        };
        readonly SupersedeDagProposalResponse: {
            readonly proposal: components["schemas"]["DagProposalRecord"];
            readonly session: Record<string, never>;
            readonly superseded_proposal: components["schemas"]["DagProposalRecord"] | null;
        };
        readonly SuperviseEvidenceDelta: {
            /** Format: date-time */
            readonly created_at: string;
            readonly evidence_id: string;
            /** @enum {integer} */
            readonly evidence_schema_version: 1 | 2;
            readonly input_ref: string | null;
            readonly job_id: string;
            /** @enum {string} */
            readonly kind: "prompt" | "model_turn" | "model_text" | "thinking" | "tool_call" | "tool_result" | "handoff" | "artifact_ref" | "error" | "usage" | "log";
            readonly node_run_id: string;
            readonly output_ref: string | null;
            /** @enum {string} */
            readonly redaction_status: "not_required" | "redacted" | "blocked";
            readonly run_id: string;
            readonly sequence: number | null;
            readonly source: components["schemas"]["WorkerEvidenceSource"];
            readonly storage_uri: string | null;
            readonly summary: string;
            readonly trace: components["schemas"]["WorkerEvidenceTrace"];
            readonly usage: components["schemas"]["UsageSummary"] | null;
            readonly worker_id: string;
        };
        readonly SuperviseRunResponse: {
            readonly changed_nodes: readonly components["schemas"]["RuntimeGraphNode"][];
            readonly cursor: string;
            readonly deltas: {
                readonly artifacts: readonly components["schemas"]["Artifact"][];
                readonly events: readonly components["schemas"]["Event"][];
                readonly evidence: readonly components["schemas"]["SuperviseEvidenceDelta"][];
                readonly handoffs: readonly components["schemas"]["NodeHandoffRecord"][];
            };
            readonly frontier: readonly string[];
            readonly gates: {
                readonly approvals: readonly components["schemas"]["ApprovalRecord"][];
                readonly human_inputs: readonly components["schemas"]["HumanInputRecord"][];
            };
            readonly graph_revision: number;
            readonly has_more: boolean;
            readonly next_poll_after_ms: number;
            readonly resources: {
                readonly active_jobs: number;
                readonly active_leases: number;
                readonly connected_ephemeral_workers: number;
            };
            readonly route: components["schemas"]["RunRoute"];
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly settled: boolean;
            readonly status: string;
        };
        readonly TemplateLineageResponse: {
            readonly family_id: string;
            readonly items: readonly Record<string, never>[];
            readonly root_template_id: string;
        };
        readonly TemplateSummary: {
            readonly name: string;
            /** @enum {string} */
            readonly status: "draft" | "published" | "archived";
            readonly template_id: string;
            readonly version: number;
        };
        readonly TraceProjection: {
            /** @enum {string} */
            readonly completeness: "complete" | "legacy_partial";
            readonly cursor: string | null;
            readonly has_more: boolean;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly spans: readonly components["schemas"]["TraceSpan"][];
            readonly trace_id: string;
        };
        readonly TraceSpan: {
            readonly attributes: {
                readonly [key: string]: string | number | boolean | null;
            };
            /** Format: date-time */
            readonly finished_at: string | null;
            readonly input_ref: string | null;
            readonly job_id: string | null;
            /** @enum {string} */
            readonly kind: "run" | "node" | "job" | "model" | "tool" | "handoff" | "artifact" | "control";
            readonly model: string | null;
            readonly name: string;
            readonly node_run_id: string | null;
            readonly output_ref: string | null;
            readonly parent_span_id: string | null;
            readonly provider: string | null;
            readonly run_id: string;
            readonly span_id: string;
            /** Format: date-time */
            readonly started_at: string;
            /** @enum {string} */
            readonly status: "ok" | "error" | "unknown";
            readonly tool_call_id: string | null;
            readonly trace_id: string;
            readonly usage: components["schemas"]["UsageSummary"] | null;
        };
        readonly UpdateAgentHostingRequest: {
            readonly model?: string | null;
            readonly openclaw_agent_id?: string;
            readonly provider?: string | null;
            readonly runtime_mode?: string | null;
        };
        readonly UpdateDagProposalAssignmentsRequest: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
        };
        readonly UpdateWorkspaceMemberRequest: {
            readonly display_name?: string;
            /** @enum {string} */
            readonly principal_type?: "user" | "service" | "development";
            readonly role: components["schemas"]["WorkspaceRole"];
            /** @enum {string} */
            readonly status?: "active" | "revoked";
        };
        readonly UsageSummary: {
            /** @enum {string} */
            readonly availability: "available" | "partial" | "unavailable";
            readonly cache_read_tokens: number | null;
            readonly cache_write_tokens: number | null;
            readonly duration_ms: number | null;
            readonly estimated_cost: Record<string, never> | null;
            readonly input_tokens: number | null;
            readonly output_tokens: number | null;
            readonly provider_reported_cost: Record<string, never> | null;
            readonly reasoning_tokens: number | null;
            readonly total_tokens: number | null;
            readonly turn_count: number | null;
        };
        readonly WorkerEvidenceSource: {
            readonly model: string | null;
            readonly native_event_id: string | null;
            readonly provider: string | null;
            readonly synthetic: boolean;
        };
        readonly WorkerEvidenceTrace: {
            readonly parent_span_id: string | null;
            readonly span_id: string;
            readonly tool_call_id: string | null;
            readonly trace_id: string;
        };
        readonly WorkspaceMemberRecord: {
            /** Format: date-time */
            readonly created_at: string;
            readonly display_name: string;
            readonly principal_id: string;
            /** @enum {string} */
            readonly principal_type: "user" | "service" | "development";
            readonly role: components["schemas"]["WorkspaceRole"];
            /** @enum {string} */
            readonly status: "active" | "revoked";
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly WorkspaceMembership: {
            readonly role: components["schemas"]["WorkspaceRole"];
            readonly workspace_id: string;
            readonly workspace_name: string;
        };
        /** @enum {string} */
        readonly WorkspacePermission: "workspace.read" | "workspace.manage_members" | "registry.manage" | "mission.create" | "mission.edit" | "run.create" | "run.control" | "run.evaluate" | "gate.resolve" | "audit.read";
        readonly WorkspaceRecord: {
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly name: string;
            /** @enum {string} */
            readonly status: "active" | "archived";
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly WorkspaceRole: "owner" | "admin" | "operator" | "viewer";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type SchemaAgentHostingSummary = components['schemas']['AgentHostingSummary'];
export type SchemaAgentProfile = components['schemas']['AgentProfile'];
export type SchemaApprovalRecord = components['schemas']['ApprovalRecord'];
export type SchemaArtifact = components['schemas']['Artifact'];
export type SchemaAuthenticatedPrincipal = components['schemas']['AuthenticatedPrincipal'];
export type SchemaAuthMeResponse = components['schemas']['AuthMeResponse'];
export type SchemaCommentRequest = components['schemas']['CommentRequest'];
export type SchemaConfirmDagProposalRequest = components['schemas']['ConfirmDagProposalRequest'];
export type SchemaConfirmDagProposalResponse = components['schemas']['ConfirmDagProposalResponse'];
export type SchemaCreateDagProposalRequest = components['schemas']['CreateDagProposalRequest'];
export type SchemaCreateDagProposalResponse = components['schemas']['CreateDagProposalResponse'];
export type SchemaCreateEvaluationRequest = components['schemas']['CreateEvaluationRequest'];
export type SchemaCreateReplayPlanRequest = components['schemas']['CreateReplayPlanRequest'];
export type SchemaCreateRerunRequest = components['schemas']['CreateRerunRequest'];
export type SchemaCreateRerunResponse = components['schemas']['CreateRerunResponse'];
export type SchemaCreateRunRequest = components['schemas']['CreateRunRequest'];
export type SchemaCreateRunResponse = components['schemas']['CreateRunResponse'];
export type SchemaCreateScorecardRequest = components['schemas']['CreateScorecardRequest'];
export type SchemaCreateTemplateRequest = components['schemas']['CreateTemplateRequest'];
export type SchemaCreateWorkspaceRequest = components['schemas']['CreateWorkspaceRequest'];
export type SchemaDagProposalAssignment = components['schemas']['DagProposalAssignment'];
export type SchemaDagProposalPlannerContext = components['schemas']['DagProposalPlannerContext'];
export type SchemaDagProposalRecord = components['schemas']['DagProposalRecord'];
export type SchemaDagProposalResponse = components['schemas']['DagProposalResponse'];
export type SchemaDagProposalStatus = components['schemas']['DagProposalStatus'];
export type SchemaDagProposalSummary = components['schemas']['DagProposalSummary'];
export type SchemaDashboardComparisonMetric = components['schemas']['DashboardComparisonMetric'];
export type SchemaDashboardObservabilityComparison = components['schemas']['DashboardObservabilityComparison'];
export type SchemaDashboardObservabilityQuery = components['schemas']['DashboardObservabilityQuery'];
export type SchemaDashboardObservabilityRetention = components['schemas']['DashboardObservabilityRetention'];
export type SchemaDashboardSummaryResponse = components['schemas']['DashboardSummaryResponse'];
export type SchemaDeriveTemplateRequest = components['schemas']['DeriveTemplateRequest'];
export type SchemaDoctorCheck = components['schemas']['DoctorCheck'];
export type SchemaDoctorReport = components['schemas']['DoctorReport'];
export type SchemaDoctorRequest = components['schemas']['DoctorRequest'];
export type SchemaError = components['schemas']['Error'];
export type SchemaEvaluationFinding = components['schemas']['EvaluationFinding'];
export type SchemaEvaluationResult = components['schemas']['EvaluationResult'];
export type SchemaEvaluatorDescriptor = components['schemas']['EvaluatorDescriptor'];
export type SchemaEvent = components['schemas']['Event'];
export type SchemaExecutionMaintenanceResult = components['schemas']['ExecutionMaintenanceResult'];
export type SchemaHumanInputRecord = components['schemas']['HumanInputRecord'];
export type SchemaHumanInputSubmitRequest = components['schemas']['HumanInputSubmitRequest'];
export type SchemaLegacyConfirmDagProposalRequest = components['schemas']['LegacyConfirmDagProposalRequest'];
export type SchemaLegacyCreateDagProposalRequest = components['schemas']['LegacyCreateDagProposalRequest'];
export type SchemaLegacyDagProposalAssignment = components['schemas']['LegacyDagProposalAssignment'];
export type SchemaLegacyDagProposalPlannerContext = components['schemas']['LegacyDagProposalPlannerContext'];
export type SchemaLegacyDagProposalRecord = components['schemas']['LegacyDagProposalRecord'];
export type SchemaLegacyDagProposalSummary = components['schemas']['LegacyDagProposalSummary'];
export type SchemaLegacyRejectDagProposalRequest = components['schemas']['LegacyRejectDagProposalRequest'];
export type SchemaLegacySupersedeDagProposalRequest = components['schemas']['LegacySupersedeDagProposalRequest'];
export type SchemaLegacyUpdateDagProposalAssignmentsRequest = components['schemas']['LegacyUpdateDagProposalAssignmentsRequest'];
export type SchemaListDagProposalsResponse = components['schemas']['ListDagProposalsResponse'];
export type SchemaMobileHomeResponse = components['schemas']['MobileHomeResponse'];
export type SchemaMobileInboxItem = components['schemas']['MobileInboxItem'];
export type SchemaMobileRunDetail = components['schemas']['MobileRunDetail'];
export type SchemaMobileRunFollowUp = components['schemas']['MobileRunFollowUp'];
export type SchemaMobileRunSummary = components['schemas']['MobileRunSummary'];
export type SchemaMobileTask = components['schemas']['MobileTask'];
export type SchemaNodeHandoffRecord = components['schemas']['NodeHandoffRecord'];
export type SchemaPlannerCandidatePlanRequest = components['schemas']['PlannerCandidatePlanRequest'];
export type SchemaPlannerCandidatePlanResponse = components['schemas']['PlannerCandidatePlanResponse'];
export type SchemaPlannerDagDraftRequest = components['schemas']['PlannerDagDraftRequest'];
export type SchemaPlannerDagDraftResponse = components['schemas']['PlannerDagDraftResponse'];
export type SchemaPlannerRegistryRecommendation = components['schemas']['PlannerRegistryRecommendation'];
export type SchemaPlannerRegistryValidation = components['schemas']['PlannerRegistryValidation'];
export type SchemaPlannerTemplateCandidate = components['schemas']['PlannerTemplateCandidate'];
export type SchemaPlannerTemplateSelectionRequest = components['schemas']['PlannerTemplateSelectionRequest'];
export type SchemaPlannerTemplateSelectionResponse = components['schemas']['PlannerTemplateSelectionResponse'];
export type SchemaPlannerValidationResult = components['schemas']['PlannerValidationResult'];
export type SchemaPublishTemplateResponse = components['schemas']['PublishTemplateResponse'];
export type SchemaRegistryProvenance = components['schemas']['RegistryProvenance'];
export type SchemaRejectDagProposalRequest = components['schemas']['RejectDagProposalRequest'];
export type SchemaReplayDifference = components['schemas']['ReplayDifference'];
export type SchemaReplayPlanRecommendation = components['schemas']['ReplayPlanRecommendation'];
export type SchemaReplayPlanResult = components['schemas']['ReplayPlanResult'];
export type SchemaReplayResult = components['schemas']['ReplayResult'];
export type SchemaRunDetail = components['schemas']['RunDetail'];
export type SchemaRunRoute = components['schemas']['RunRoute'];
export type SchemaRunSummary = components['schemas']['RunSummary'];
export type SchemaRuntimeGraphNode = components['schemas']['RuntimeGraphNode'];
export type SchemaRunValidationFailure = components['schemas']['RunValidationFailure'];
export type SchemaScorecardFinding = components['schemas']['ScorecardFinding'];
export type SchemaScorecardResult = components['schemas']['ScorecardResult'];
export type SchemaSecurityAuditEvent = components['schemas']['SecurityAuditEvent'];
export type SchemaSkill = components['schemas']['Skill'];
export type SchemaSupersedeDagProposalRequest = components['schemas']['SupersedeDagProposalRequest'];
export type SchemaSupersedeDagProposalResponse = components['schemas']['SupersedeDagProposalResponse'];
export type SchemaSuperviseEvidenceDelta = components['schemas']['SuperviseEvidenceDelta'];
export type SchemaSuperviseRunResponse = components['schemas']['SuperviseRunResponse'];
export type SchemaTemplateLineageResponse = components['schemas']['TemplateLineageResponse'];
export type SchemaTemplateSummary = components['schemas']['TemplateSummary'];
export type SchemaTraceProjection = components['schemas']['TraceProjection'];
export type SchemaTraceSpan = components['schemas']['TraceSpan'];
export type SchemaUpdateAgentHostingRequest = components['schemas']['UpdateAgentHostingRequest'];
export type SchemaUpdateDagProposalAssignmentsRequest = components['schemas']['UpdateDagProposalAssignmentsRequest'];
export type SchemaUpdateWorkspaceMemberRequest = components['schemas']['UpdateWorkspaceMemberRequest'];
export type SchemaUsageSummary = components['schemas']['UsageSummary'];
export type SchemaWorkerEvidenceSource = components['schemas']['WorkerEvidenceSource'];
export type SchemaWorkerEvidenceTrace = components['schemas']['WorkerEvidenceTrace'];
export type SchemaWorkspaceMemberRecord = components['schemas']['WorkspaceMemberRecord'];
export type SchemaWorkspaceMembership = components['schemas']['WorkspaceMembership'];
export type SchemaWorkspacePermission = components['schemas']['WorkspacePermission'];
export type SchemaWorkspaceRecord = components['schemas']['WorkspaceRecord'];
export type SchemaWorkspaceRole = components['schemas']['WorkspaceRole'];
export type $defs = Record<string, never>;
export interface operations {
    readonly listSecurityAuditEvents: {
        readonly parameters: {
            readonly query?: {
                readonly action?: string;
                readonly limit?: number;
                readonly outcome?: "allowed" | "denied" | "error";
                readonly principal_id?: string;
                readonly resource_type?: string;
                readonly since?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Audit event list and chain verification state */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly chain_verified: boolean;
                        readonly filters: Record<string, never>;
                        readonly items: readonly components["schemas"]["SecurityAuditEvent"][];
                    };
                };
            };
        };
    };
    readonly getCurrentIdentity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Trusted request identity */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AuthMeResponse"];
                };
            };
            /** @description Missing or invalid trusted identity */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly createDoctorReport: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["DoctorRequest"];
            };
        };
        readonly responses: {
            /** @description Readiness report; failed checks are represented in the body */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DoctorReport"];
                };
            };
            /** @description Invalid diagnostic mode or runtime */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly listRunEvaluations: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Evaluation list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["EvaluationResult"][];
                    };
                };
            };
        };
    };
    readonly createRunEvaluation: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateEvaluationRequest"];
            };
        };
        readonly responses: {
            /** @description Existing terminal evaluation */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["EvaluationResult"];
                };
            };
            /** @description Synchronous evaluation completed */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["EvaluationResult"];
                };
            };
            /** @description Model evaluation queued or running */
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["EvaluationResult"];
                };
            };
            /** @description Run is not terminal or settled */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getRunEvaluation: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly evaluationId: string;
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Evaluation detail */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["EvaluationResult"];
                };
            };
            /** @description Run or evaluation not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly createRunReplayPlan: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateReplayPlanRequest"];
            };
        };
        readonly responses: {
            /** @description Existing replay plan for the same evidence inputs */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayPlanResult"];
                };
            };
            /** @description Replay plan persisted */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayPlanResult"];
                };
            };
        };
    };
    readonly getRunReplayPlan: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly replayPlanId: string;
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Replay plan */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayPlanResult"];
                };
            };
            /** @description Replay plan not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly createRunReplay: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Existing replay for the same immutable event digest */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayResult"];
                };
            };
            /** @description Replay result persisted */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayResult"];
                };
            };
        };
    };
    readonly getRunReplay: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly replayId: string;
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Replay result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReplayResult"];
                };
            };
            /** @description Replay not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly listRunScorecards: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Scorecard list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["ScorecardResult"][];
                    };
                };
            };
        };
    };
    readonly createRunScorecard: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateScorecardRequest"];
            };
        };
        readonly responses: {
            /** @description Existing scorecard returned for the same evidence digest and policy */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ScorecardResult"];
                };
            };
            /** @description Scorecard created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ScorecardResult"];
                };
            };
            /** @description Run is not terminal or runtime resources are not settled */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getRunScorecard: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly runId: string;
                readonly scorecardId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Scorecard detail */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ScorecardResult"];
                };
            };
            /** @description Run or scorecard not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly superviseRun: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly limit?: number;
            };
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current state and bounded deltas */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SuperviseRunResponse"];
                };
            };
            /** @description Malformed cursor or cursor for another run */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Run not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getRunTrace: {
        readonly parameters: {
            readonly query?: {
                readonly cursor?: string;
                readonly kind?: "run" | "node" | "job" | "model" | "tool" | "handoff" | "artifact" | "control";
                readonly limit?: number;
                readonly node_run_id?: string;
            };
            readonly header?: never;
            readonly path: {
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Trace span projection */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TraceProjection"];
                };
            };
            /** @description Invalid filter or cursor */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Run not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly listWorkspaces: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Workspace list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["WorkspaceRecord"][];
                    };
                };
            };
        };
    };
    readonly createWorkspace: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateWorkspaceRequest"];
            };
        };
        readonly responses: {
            /** @description Workspace created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly membership: components["schemas"]["WorkspaceMemberRecord"];
                        readonly workspace: components["schemas"]["WorkspaceRecord"];
                    };
                };
            };
        };
    };
    readonly listWorkspaceMembers: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly workspaceId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Workspace member list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["WorkspaceMemberRecord"][];
                    };
                };
            };
        };
    };
    readonly updateWorkspaceMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly principalId: string;
                readonly workspaceId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UpdateWorkspaceMemberRequest"];
            };
        };
        readonly responses: {
            /** @description Membership updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceMemberRecord"];
                };
            };
        };
    };
}
