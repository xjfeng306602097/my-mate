// This file is generated from openapi/control-plane.openapi.yaml.
// Run `npm --prefix packages/shared-types run generate:control-plane` to update it.
export type paths = {
    readonly "/api/agent-dags": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List durable Agent DAGs */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAGs */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["AgentDag"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create a durable Agent DAG */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
            readonly responses: {
                /** @description Agent DAG */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentDag"];
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
    readonly "/api/agent-dags/{dagId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get DAG nodes, Agent Tasks, and Agent Protocol messages */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAG detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly dag: components["schemas"]["AgentDag"];
                            readonly gates: readonly components["schemas"]["AgentDagGate"][];
                            readonly messages: readonly components["schemas"]["AgentMessage"][];
                            readonly tasks: readonly components["schemas"]["AgentTask"][];
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
    readonly "/api/agent-dags/{dagId}/cancel": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Cancel an Agent DAG and cascade to active children */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAG cancelled */
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
    readonly "/api/agent-dags/{dagId}/gates": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List durable Human Gates for an Agent DAG */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAG Gates */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["AgentDagGate"][];
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
    readonly "/api/agent-dags/{dagId}/gates/{gateId}/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Resolve an Agent DAG Human Gate and optionally resume execution */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                    readonly gateId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly approved: boolean;
                        readonly response?: {
                            readonly [key: string]: unknown;
                        };
                    };
                };
            };
            readonly responses: {
                /** @description Agent DAG Gate resolved */
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
    readonly "/api/agent-dags/{dagId}/retry": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reset failed or blocked nodes for recovery */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAG ready for retry */
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
    readonly "/api/agent-dags/{dagId}/run": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Run ready Agent DAG nodes within policy budgets */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent DAG run result */
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
    readonly "/api/agent-dags/{dagId}/tasks": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Add a version-pinned Agent Task node */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly dagId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
            readonly responses: {
                /** @description Agent DAG Task added */
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
    readonly "/api/agent-runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List AgentRun lifecycle evidence */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent runs */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["AgentRun"][];
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
    readonly "/api/agent-runs/{agentRunId}/events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List ordered user-facing activity for one AgentRun */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly after_sequence?: number;
                    readonly limit?: number;
                };
                readonly header?: never;
                readonly path: {
                    readonly agentRunId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Ordered AgentRun activity page */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly after_sequence: number;
                            readonly has_more: boolean;
                            readonly items: readonly components["schemas"]["AgentRunEvent"][];
                            readonly next_after_sequence: number;
                        };
                    };
                };
                /** @description AgentRun not found */
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
    readonly "/api/agent-runs/{agentRunId}/events/stream": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Stream ordered AgentRun activity with resumable SSE ids */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly after_sequence?: number;
                };
                readonly header?: {
                    readonly "Last-Event-ID"?: number;
                };
                readonly path: {
                    readonly agentRunId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description SSE stream. Each agent.event uses the durable sequence as its event id. */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "text/event-stream": string;
                    };
                };
                /** @description AgentRun not found */
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
    readonly "/api/agent-teams": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List version-pinned Agent Teams */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent Teams */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["AgentTeam"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create or update an Agent Team */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
            readonly responses: {
                /** @description Agent Team */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentTeam"];
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
    readonly "/api/agents": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List versioned Agents, published versions, deployments, and Workflow migration diagnostics */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent registry */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly deployments: readonly {
                                readonly [key: string]: unknown;
                            }[];
                            readonly items: readonly components["schemas"]["AgentDefinition"][];
                            readonly versions: readonly components["schemas"]["AgentVersion"][];
                            readonly workflow_migration: {
                                readonly [key: string]: unknown;
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Publish a new Agent definition or immutable version */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly agent_id?: string;
                        readonly description?: string;
                        readonly name: string;
                        readonly version?: {
                            readonly [key: string]: unknown;
                        };
                    };
                };
            };
            readonly responses: {
                /** @description Agent version published */
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
    readonly "/api/agents/{agentId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get an Agent definition and selected version */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly version?: number;
                };
                readonly header?: never;
                readonly path: {
                    readonly agentId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent definition and version */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/agents/{agentId}/bind": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Resolve an immutable Agent binding snapshot */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly agentId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
            readonly responses: {
                /** @description Agent binding snapshot */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentBindingSnapshot"];
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
    readonly "/api/agents/{agentId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable an Agent definition */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly agentId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Agent disabled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["AgentDefinition"];
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
    readonly "/api/governance/changes": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List workspace registry governance changes */
        readonly get: operations["listGovernanceChanges"];
        readonly put?: never;
        /** Propose a protected registry or template lifecycle change */
        readonly post: operations["createGovernanceChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/governance/changes/{changeId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return one workspace governance change */
        readonly get: operations["getGovernanceChange"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/governance/changes/{changeId}/apply": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Apply an approved change when the resource baseline still matches */
        readonly post: operations["applyGovernanceChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/governance/changes/{changeId}/approve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Approve a pending governance change */
        readonly post: operations["approveGovernanceChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/governance/changes/{changeId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject a pending governance change */
        readonly post: operations["rejectGovernanceChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/governance/policy": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return the active workspace governance policy */
        readonly get: operations["getGovernancePolicy"];
        readonly put?: never;
        /** Update approval requirements for protected registry changes */
        readonly post: operations["updateGovernancePolicy"];
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
    readonly "/api/memories": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List durable memories in the selected Workspace */
        readonly get: operations["listMemories"];
        readonly put?: never;
        /** Store an explicit durable memory */
        readonly post: operations["createMemory"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memories/{memoryId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        /** Read one durable memory */
        readonly get: operations["getMemory"];
        readonly put?: never;
        readonly post?: never;
        /** Soft-delete a durable memory */
        readonly delete: operations["deleteMemory"];
        readonly options?: never;
        readonly head?: never;
        /** Update a durable memory and increment its version */
        readonly patch: operations["updateMemory"];
        readonly trace?: never;
    };
    readonly "/api/memories/{memoryId}/purge": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Physically remove a Memory and all content-bearing derived copies */
        readonly post: operations["hardPurgeMemory"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memories/{memoryId}/restore": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Restore a soft-deleted or expired canonical memory */
        readonly post: operations["restoreMemory"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memories/export": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Export canonical memories as JSON or JSONL */
        readonly get: operations["exportMemories"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memories/import": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Validate or import portable memories without preserving foreign canonical ids */
        readonly post: operations["importMemories"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-backups": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List encrypted Memory backup metadata */
        readonly get: operations["listMemoryBackups"];
        readonly put?: never;
        /** Create a passphrase-encrypted logical Memory backup */
        readonly post: operations["createEncryptedMemoryBackup"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-backups/{backupId}/restore": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Verify or restore an encrypted Memory backup */
        readonly post: operations["restoreEncryptedMemoryBackup"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-candidates": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List proposed memory writes awaiting or after review */
        readonly get: operations["listMemoryCandidates"];
        readonly put?: never;
        /** Propose an inferred memory for governed review */
        readonly post: operations["createMemoryCandidate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-candidates/{candidateId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read one governed memory candidate */
        readonly get: operations["getMemoryCandidate"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-candidates/{candidateId}/approve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Approve a candidate and atomically create its durable memory */
        readonly post: operations["approveMemoryCandidate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-candidates/{candidateId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject a candidate without writing durable memory */
        readonly post: operations["rejectMemoryCandidate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-collections": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listMemoryCollections"];
        readonly put?: never;
        readonly post: operations["createMemoryCollection"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-collections/{collectionId}": {
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
        readonly patch: operations["updateMemoryCollection"];
        readonly trace?: never;
    };
    readonly "/api/memory-conflicts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listMemoryConflicts"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-conflicts/{conflictId}/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["resolveMemoryConflict"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-effectiveness": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get correlation-only Memory activation and feedback metrics */
        readonly get: operations["getMemoryEffectiveness"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-external-sources": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listMemoryExternalSources"];
        readonly put?: never;
        readonly post: operations["createMemoryExternalSource"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-external-sources/{sourceId}/ingest": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["ingestExternalMemoryBatch"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-external-sources/{sourceId}/sync": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["syncExternalMemorySource"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-integrity/scan": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Verify Memory schemas, encrypted payloads, Workspace boundaries, and references */
        readonly post: operations["scanMemoryIntegrity"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-intelligence/evaluation": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Run the built-in deterministic Conversation intent quality suite */
        readonly get: operations["evaluateMemoryIntelligence"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-keys/rotate": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Re-encrypt Private Memory under a new Workspace data key and destroy retired keys */
        readonly post: operations["rotateMemoryEncryptionKey"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-knowledge/query": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Query Workspace-filtered derived relations from the optional provider */
        readonly post: operations["queryMemoryKnowledgeGraph"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-knowledge/rebuild": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Re-sync eligible canonical Memory records into the optional provider */
        readonly post: operations["rebuildMemoryKnowledgeGraph"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-knowledge/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Inspect the optional MemPalace knowledge graph provider */
        readonly get: operations["getMemoryKnowledgeProviderStatus"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-maintenance": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get the latest memory maintenance result */
        readonly get: operations["getMemoryMaintenance"];
        readonly put?: never;
        /** Expire canonical memories and compact derived data under retention policy */
        readonly post: operations["runMemoryMaintenance"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-maintenance/sweep": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Run due memory maintenance independently across all discovered Workspaces */
        readonly post: operations["runMemoryMaintenanceSweep"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-observability": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get persisted memory subsystem counters and latency */
        readonly get: operations["getMemoryObservability"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-onboarding": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getMemoryOnboarding"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-onboarding/complete": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["completeMemoryOnboarding"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-onboarding/dismiss": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["dismissMemoryOnboarding"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-onboarding/preview": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["previewMemoryOnboarding"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-onboarding/start": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["startMemoryOnboarding"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-operations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return key, retention, backup, and integrity status without secret material */
        readonly get: operations["getMemoryOperationsStatus"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-retention/run": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Apply explicit Workspace Memory retention policy */
        readonly post: operations["runMemoryRetention"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-retrieval/rebuild": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Rebuild all derived memory retrieval data from canonical Memory records */
        readonly post: operations["rebuildMemoryRetrieval"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-retrieval/search": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Search visible canonical memories with rebuildable hybrid retrieval */
        readonly post: operations["searchLongTermMemory"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-retrieval/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Inspect derived memory index and embedding provider status */
        readonly get: operations["getMemoryRetrievalStatus"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-settings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get Workspace memory settings */
        readonly get: operations["getMemorySettings"];
        /** Update Workspace memory settings */
        readonly put: operations["updateMemorySettings"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-shares": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listMemoryShares"];
        readonly put?: never;
        readonly post: operations["createMemoryShare"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-shares/{shareId}/revoke": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["revokeMemoryShare"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/memory-shares/{shareId}/suggest": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["suggestSharedMemoryChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/missions/{sessionId}/materializer": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Return the evented Mission materializer status and digests */
        readonly get: operations["getMissionMaterializerStatus"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/missions/{sessionId}/materializer/rebuild": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Rebuild the Mission projection exclusively from its event log */
        readonly post: operations["rebuildMissionMaterializer"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/missions/{sessionId}/materializer/verify": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Compare the event-rebuilt and current direct Mission projections */
        readonly post: operations["verifyMissionMaterializer"];
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
    readonly "/api/notifications": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Workspace in-app notifications */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly status?: "active" | "unread" | "all";
                };
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Notification list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["Notification"][];
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
    readonly "/api/notifications/{notificationId}/{action}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Mark a notification read or dismiss it */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly action: "read" | "dismiss";
                    readonly notificationId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Updated notification */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["Notification"];
                    };
                };
                /** @description Notification not found */
                readonly 404: {
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
    readonly "/api/projects": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listLocalProjects"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/registry/mcp-connector-presets": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List built-in MCP connector presets without secret values */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description MCP connector presets */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["McpConnectorPreset"][];
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
    readonly "/api/registry/mcp-servers": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Workspace-scoped MCP servers without secret values */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description MCP servers */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["McpServer"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /**
         * Upsert a public Streamable HTTP MCP server
         * @description Stdio servers require the Desktop-only authenticated configuration route.
         */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["UpsertMcpServerRequest"];
                };
            };
            readonly responses: {
                /** @description MCP server saved */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["McpServer"];
                    };
                };
                /** @description Desktop authorization is required for stdio */
                readonly 403: {
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
    readonly "/api/registry/mcp-servers/{serverId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable an MCP server and unregister its tools */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly serverId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description MCP server disabled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["McpServer"];
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
    readonly "/api/registry/mcp-servers/{serverId}/enable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Enable a Streamable HTTP MCP server */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly serverId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description MCP server enabled */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["McpServer"];
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
    readonly "/api/registry/mcp-servers/{serverId}/test": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Connect and rediscover a Streamable HTTP MCP server */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly serverId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description MCP connection tested */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["McpServer"];
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
    readonly "/api/registry/mcp-servers/reload": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reload MCP servers in the selected Workspace */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Reloaded MCP servers */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["McpServer"][];
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
    readonly "/api/registry/provider-connections": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Provider Connections without secret values */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Provider Connections */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["ProviderConnection"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Upsert a multi-model Provider Connection with a managed or environment credential */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["UpsertProviderConnectionRequest"];
                };
            };
            readonly responses: {
                /** @description Provider Connection saved */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["ProviderConnection"];
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
    readonly "/api/registry/provider-connections/{connectionId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get a Provider Connection */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly connectionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Provider Connection */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["ProviderConnection"];
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
    readonly "/api/registry/provider-connections/{connectionId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable a Provider Connection */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly connectionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Disabled Provider Connection */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["ProviderConnection"];
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
    readonly "/api/registry/provider-connections/{connectionId}/test": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Send a minimal live request to verify a Provider Connection */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly connectionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Provider Connection test completed */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly connection: components["schemas"]["ProviderConnection"];
                            readonly report: components["schemas"]["DoctorReport"];
                            readonly verification: {
                                readonly detail: string;
                                readonly duration_ms: number;
                                readonly model: string | null;
                                /** @enum {string} */
                                readonly status: "verified" | "failed";
                                /** Format: date-time */
                                readonly tested_at: string;
                            };
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
    readonly "/api/runs/{runId}/nodes/{nodeRunId}/recovery-replays": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Replay a failed node from its frozen Job identity */
        readonly post: operations["createNodeFailureReplay"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/recovery": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get timeout compensation and failure replay posture for one run */
        readonly get: operations["getRunRecovery"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/recovery-replays/{replayId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get one persisted failure execution replay */
        readonly get: operations["getNodeFailureReplay"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/runs/{runId}/recovery/scan": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Detect expired execution deadlines and continue pending compensation */
        readonly post: operations["scanRunRecovery"];
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
    readonly "/api/runtime/workspace-change-sets": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Runtime Worker workspace change sets */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly status?: "pending" | "applied" | "rejected" | "blocked" | "apply_failed";
                };
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Workspace change set list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["RuntimeWorkspaceChangeSet"][];
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
    readonly "/api/runtime/workspace-change-sets/{changeSetId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get a Runtime Worker workspace change set */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly changeSetId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Workspace change set */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["RuntimeWorkspaceChangeSet"];
                    };
                };
                /** @description Not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/runtime/workspace-change-sets/{changeSetId}/apply": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Apply a reviewed workspace change set to its source workspace */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly changeSetId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CommentRequest"];
                };
            };
            readonly responses: {
                /** @description Applied change set */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["RuntimeWorkspaceChangeSet"];
                    };
                };
                /** @description Source workspace changed or change set is not pending */
                readonly 409: {
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
    readonly "/api/runtime/workspace-change-sets/{changeSetId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject a pending workspace change set */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly changeSetId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: {
                readonly content: {
                    readonly "application/json": components["schemas"]["CommentRequest"];
                };
            };
            readonly responses: {
                /** @description Rejected change set */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["RuntimeWorkspaceChangeSet"];
                    };
                };
                /** @description Change set is not pending */
                readonly 409: {
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
    readonly "/api/schedules": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Workspace schedules */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Schedule list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["UserSchedule"][];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create a Workspace schedule */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": components["schemas"]["UserScheduleRequest"];
                };
            };
            readonly responses: {
                /** @description Created schedule */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["UserSchedule"];
                    };
                };
                /** @description Invalid schedule */
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
    readonly "/api/schedules/{scheduleId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Delete a Workspace schedule while retaining run history */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly scheduleId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Schedule deleted */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Schedule not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        /** Update or enable a Workspace schedule */
        readonly patch: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly scheduleId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
            readonly responses: {
                /** @description Updated schedule */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["UserSchedule"];
                    };
                };
                /** @description Schedule not found */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly trace?: never;
    };
    readonly "/api/schedules/{scheduleId}/run": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Run a schedule immediately through the normal Conversation boundary */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly scheduleId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Completed or paused schedule run */
                readonly 202: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["UserScheduleRun"];
                    };
                };
                /** @description Schedule is already running */
                readonly 409: {
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
    readonly "/api/schedules/{scheduleId}/runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List durable schedule execution history */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly limit?: number;
                };
                readonly header?: never;
                readonly path: {
                    readonly scheduleId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Schedule run list */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["UserScheduleRun"][];
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
    readonly "/api/session-recall/search": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Search exact evidence in earlier Sessions from the selected Workspace */
        readonly post: operations["searchHistoricalSessions"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/artifacts/{artifactId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSessionGeneratedArtifact"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/artifacts/{artifactId}/compare": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["compareSessionGeneratedArtifact"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/artifacts/{artifactId}/download": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["downloadSessionGeneratedArtifact"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/autopilot": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSessionAutopilot"];
        readonly put: operations["updateSessionAutopilot"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/autopilot/pause": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["pauseSessionAutopilot"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/autopilot/resume": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["resumeSessionAutopilot"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/autopilot/tick": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["tickSessionAutopilot"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/checkpoints": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List durable Task checkpoints for a Session */
        readonly get: operations["listTaskCheckpoints"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/checkpoints/{checkpointId}/resume": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Explicitly resume the latest resumable Task checkpoint */
        readonly post: operations["resumeTaskCheckpoint"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/checkpoints/latest": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get the latest durable Task checkpoint for a Session */
        readonly get: operations["getLatestTaskCheckpoint"];
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
                            readonly agent_dag: components["schemas"]["AgentDag"];
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
    readonly "/api/sessions/{sessionId}/memory-contexts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listSessionTurnMemoryContexts"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-contexts/{contextId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSessionTurnMemoryContext"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-overlay": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listSessionMemoryOverlays"];
        readonly put?: never;
        readonly post: operations["createSessionMemoryOverlay"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-overlay/{overlayId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        readonly delete: operations["revokeSessionMemoryOverlay"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-recommendations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List explainable relevant Memory recommendations for the current Session goal */
        readonly get: operations["listSessionMemoryRecommendations"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-recommendations/{recommendationId}/feedback": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Record a content-free recommendation action and optionally activate an overlay */
        readonly post: operations["createSessionMemoryRecommendationFeedback"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-review": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Run idempotent background durable-memory extraction for the latest user turn */
        readonly post: operations["reviewSessionMemory"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/memory-snapshot": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get or lazily create the frozen Core Memory snapshot for a Session */
        readonly get: operations["getSessionCoreMemorySnapshot"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/task-workspace": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSessionTaskWorkspace"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/sessions/{sessionId}/workspace-binding": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getSessionWorkspaceBinding"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/skill-host/evaluations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Skill quality evaluations */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill quality evaluations */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly put?: never;
        /** Record a Skill acceptance evaluation */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Recorded Skill evaluation */
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
    readonly "/api/skill-host/hermes/inspect": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Inspect Hermes Skill compatibility without installation */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Hermes compatibility report */
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
    readonly "/api/skill-host/install": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Install a local Skill package into the selected Workspace */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        /** @default false */
                        readonly approve_permission_delta?: boolean;
                        readonly source_path: string;
                        readonly workspace_id?: string;
                    };
                };
            };
            readonly responses: {
                /** @description Installed Skill package */
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
    readonly "/api/skill-host/invocations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Skill invocation history */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill invocation history */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["SkillInvocationRecord"][];
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
    readonly "/api/skill-host/lockfile": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read locked Skill versions and digests */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill lockfile */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/skill-host/lockfile/sync": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Synchronize the Workspace Skill lockfile */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Synchronized Skill lockfile */
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
    readonly "/api/skill-host/marketplace/install": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Scan and install a package from a governed Skill source */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        /** @default false */
                        readonly approve_permission_delta?: boolean;
                        readonly source_id: string;
                        readonly source_path: string;
                    };
                };
            };
            readonly responses: {
                /** @description Installed Skill package */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Permission delta requires explicit review */
                readonly 409: {
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
    readonly "/api/skill-host/marketplace/scan": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Quarantine-scan a Skill package */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly source_id?: string;
                        readonly source_path: string;
                    };
                };
            };
            readonly responses: {
                /** @description Skill package scan result */
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
    readonly "/api/skill-host/observability": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read Skill success, latency, compatibility, and Curator recommendations */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill observability summary */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/skill-host/packages": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List executable Skill packages for the selected Workspace */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill package catalog */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly items: readonly components["schemas"]["SkillPackageStatus"][];
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
    readonly "/api/skill-host/packages/{skillId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read one Skill package and its exact instructions */
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
                /** @description Skill package detail */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/skill-host/packages/{skillId}/disable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Disable a Skill package */
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
                /** @description Disabled Skill package */
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
    readonly "/api/skill-host/packages/{skillId}/enable": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Enable a Skill package */
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
                /** @description Enabled Skill package */
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
    readonly "/api/skill-host/packages/{skillId}/rollback": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Roll back to a retained Skill package version */
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
                /** @description Restored Skill package */
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
    readonly "/api/skill-host/packages/{skillId}/versions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List retained Skill package versions */
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
                /** @description Retained Skill versions */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/skill-host/profile": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read the Workspace Skill activation and trust policy */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Workspace Skill profile */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": components["schemas"]["SkillWorkspaceProfile"];
                    };
                };
            };
        };
        /** Update the Workspace Skill activation and trust policy */
        readonly put: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Updated Workspace Skill profile */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
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
    readonly "/api/skill-host/reload": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reload Skill package discovery */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Reloaded package catalog */
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
    readonly "/api/skill-host/sources": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List Skill catalog sources */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Skill catalog sources */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        readonly put?: never;
        /** Register a governed Skill catalog source */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Registered Skill catalog source */
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
    readonly "/api/supervision/alerts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["listSupervisionAlerts"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/supervision/alerts/{alertId}/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["resolveSupervisionAlert"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/supervision/scan": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post: operations["scanProactiveSupervision"];
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
        readonly AgentBindingSnapshot: {
            readonly agent_id: string;
            readonly agent_name: string;
            readonly agent_role: components["schemas"]["AgentRole"];
            readonly agent_version: number;
            readonly artifact_policy: {
                readonly [key: string]: unknown;
            };
            readonly autonomy_ceiling: components["schemas"]["AutonomyMode"];
            readonly binding_id: string;
            /** @enum {string} */
            readonly binding_mode: "pinned" | "follow_latest";
            readonly capability_policy?: {
                readonly [key: string]: unknown;
            };
            readonly connection_revision: string;
            readonly context_policy: {
                readonly [key: string]: unknown;
            };
            /** Format: date-time */
            readonly created_at: string;
            readonly delivery_policy: {
                readonly [key: string]: unknown;
            };
            readonly memory_policy: {
                readonly [key: string]: unknown;
            };
            readonly model: string;
            readonly model_deployment_id: string;
            readonly model_routing_policy?: {
                readonly [key: string]: unknown;
            };
            readonly provider_connection_id: string;
            readonly provider_id: string;
            readonly responsibility?: string;
            readonly runtime_policy: {
                readonly [key: string]: unknown;
            };
            /** @constant */
            readonly schema_version: 2;
            readonly skill_policy: {
                readonly [key: string]: unknown;
            };
            readonly snapshot_digest: string;
            readonly system_prompt: string;
            readonly tool_policy: {
                readonly [key: string]: unknown;
            };
            readonly workspace_policy: {
                readonly [key: string]: unknown;
            };
        };
        readonly AgentDag: {
            readonly budget_usage: {
                readonly [key: string]: unknown;
            };
            readonly dag_id: string;
            readonly delegation_depth: number;
            readonly nodes: readonly {
                readonly [key: string]: unknown;
            }[];
            readonly objective: string;
            readonly orchestrator_binding: components["schemas"]["AgentBindingSnapshot"];
            readonly parent_dag_id: string | null;
            readonly policy: {
                readonly [key: string]: unknown;
            };
            readonly revision: number;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly state: {
                readonly [key: string]: unknown;
            };
            readonly state_revision: number;
            readonly state_schema: {
                readonly [key: string]: unknown;
            };
            readonly status: components["schemas"]["AgentDagStatus"];
            readonly team_id: string | null;
            readonly title: string;
            readonly workspace_id: string;
        } & {
            readonly [key: string]: unknown;
        };
        readonly AgentDagGate: {
            readonly auto_resume: boolean;
            /** Format: date-time */
            readonly created_at: string;
            readonly dag_id: string;
            readonly gate_id: string;
            /** @enum {string} */
            readonly gate_type: "approval" | "input";
            readonly input_schema: {
                readonly [key: string]: unknown;
            };
            readonly node_id: string;
            readonly prompt: string;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly resolved_by: string | null;
            readonly response: {
                readonly [key: string]: unknown;
            } | null;
            /** @enum {string} */
            readonly status: "pending" | "approved" | "rejected" | "submitted" | "cancelled";
            readonly task_id: string;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly AgentDagStatus: "draft" | "ready" | "running" | "waiting_human" | "completed" | "failed" | "cancelled";
        readonly AgentDefinition: {
            readonly agent_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly description: string;
            readonly latest_version: number;
            readonly metadata: {
                readonly [key: string]: unknown;
            };
            readonly name: string;
            readonly published_version: number | null;
            /** @enum {string} */
            readonly status: "active" | "disabled";
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly AgentMessage: {
            readonly artifact_refs: readonly {
                readonly [key: string]: unknown;
            }[];
            readonly causation_id: string | null;
            readonly correlation_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly dag_id: string;
            readonly from_agent_run_id: string | null;
            readonly idempotency_key: string;
            readonly message_id: string;
            /** @enum {string} */
            readonly message_type: "task.request" | "task.accepted" | "task.progress" | "task.blocked" | "artifact.published" | "task.result" | "task.failed" | "task.cancel" | "task.steer" | "gate.requested" | "gate.resolved" | "agent.heartbeat";
            readonly payload: {
                readonly [key: string]: unknown;
            };
            /** @constant */
            readonly schema_version: 1;
            readonly task_id: string;
            readonly to_agent_run_id: string | null;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly AgentRole: "orchestrator" | "supervisor" | "worker" | "reviewer" | "specialist";
        readonly AgentRun: {
            readonly agent_run_id: string;
            readonly attempt: number;
            readonly binding_snapshot: components["schemas"]["AgentBindingSnapshot"];
            /** @enum {string} */
            readonly kind: "conversation" | "workflow_node" | "schedule" | "continuation" | "delegation" | "review";
            readonly node_run_id: string | null;
            readonly parent_agent_run_id: string | null;
            readonly session_id: string | null;
            readonly status: components["schemas"]["AgentRunStatus"];
            readonly workflow_run_id: string | null;
            readonly workspace_id: string;
        } & {
            readonly [key: string]: unknown;
        };
        readonly AgentRunEvent: {
            readonly agent_run_id: string;
            readonly child_session_id: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly dag_id: string;
            readonly event_id: string;
            readonly idempotency_key: string | null;
            readonly node_id: string;
            readonly payload: {
                readonly [key: string]: unknown;
            };
            readonly sequence: number;
            /** @enum {string} */
            readonly status: "info" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
            readonly summary: string;
            readonly task_id: string;
            /** @enum {string} */
            readonly type: "task.assigned" | "agent.started" | "agent.progress" | "agent.message.delta" | "agent.message.completed" | "tool.started" | "tool.waiting_approval" | "tool.completed" | "tool.failed" | "checkpoint.saved" | "artifact.created" | "handoff.returned" | "agent.completed" | "agent.failed" | "agent.cancelled";
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly AgentRunStatus: "queued" | "running" | "waiting_human" | "completed" | "failed" | "cancelled";
        readonly AgentTask: {
            readonly assigned_agent_run_id: string | null;
            readonly binding_snapshot: components["schemas"]["AgentBindingSnapshot"];
            readonly budget: {
                readonly [key: string]: unknown;
            };
            readonly dag_id: string;
            readonly depth: number;
            readonly node_id: string;
            readonly objective: string;
            readonly parent_task_id: string | null;
            readonly permission_ceiling: {
                readonly [key: string]: unknown;
            };
            readonly status: components["schemas"]["AgentTaskStatus"];
            readonly task_id: string;
            readonly title: string;
            readonly workspace_id: string;
        } & {
            readonly [key: string]: unknown;
        };
        /** @enum {string} */
        readonly AgentTaskStatus: "queued" | "accepted" | "running" | "blocked" | "completed" | "skipped" | "failed" | "cancelled";
        readonly AgentTeam: {
            readonly description: string;
            readonly members: readonly {
                readonly agent_id: string;
                readonly agent_version: number | null;
                readonly capability_tags: readonly string[];
                readonly member_id: string;
                readonly required: boolean;
                readonly role: components["schemas"]["AgentRole"];
            }[];
            readonly name: string;
            readonly orchestrator_member_id: string;
            readonly policy: {
                readonly [key: string]: unknown;
            };
            readonly reviewer_member_ids: readonly string[];
            /** @enum {string} */
            readonly status: "active" | "disabled";
            readonly team_id: string;
            readonly workspace_id: string;
        } & {
            readonly [key: string]: unknown;
        };
        readonly AgentVersion: {
            readonly agent_id: string;
            /** @enum {string} */
            readonly autonomy_ceiling: "review_first" | "assisted" | "autopilot";
            readonly context_policy: {
                readonly [key: string]: unknown;
            };
            readonly memory_policy: {
                readonly [key: string]: unknown;
            };
            readonly model_policy: {
                readonly [key: string]: unknown;
            };
            readonly role: components["schemas"]["AgentRole"];
            readonly runtime_policy: {
                readonly [key: string]: unknown;
            };
            readonly skill_policy: {
                readonly [key: string]: unknown;
            };
            /** @enum {string} */
            readonly status: "draft" | "published" | "retired";
            readonly system_prompt: string;
            readonly tool_policy: {
                readonly [key: string]: unknown;
            };
            readonly version: number;
            readonly workspace_id: string;
            readonly workspace_policy: {
                readonly [key: string]: unknown;
            };
        } & {
            readonly [key: string]: unknown;
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
            readonly publication_error?: string | null;
            /** @enum {string} */
            readonly publication_status?: "published" | "unpublished" | "failed";
            readonly published_relative_path?: string | null;
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
        /** @enum {string} */
        readonly AutonomyMode: "review_first" | "assisted" | "autopilot";
        readonly AutopilotController: {
            /** Format: date-time */
            readonly completed_at: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly handoff_reason: string | null;
            readonly iteration: number;
            readonly last_action: string | null;
            readonly last_detail: string | null;
            /** Format: date-time */
            readonly last_tick_at: string | null;
            readonly max_iterations: number;
            readonly max_runtime_minutes: number;
            readonly metadata: Record<string, never>;
            /** @enum {string} */
            readonly mode: "review_first" | "assisted" | "autopilot";
            /** Format: date-time */
            readonly next_tick_at: string | null;
            /** Format: date-time */
            readonly paused_at: string | null;
            /** @enum {string|null} */
            readonly pending_gate?: "start_confirmation" | "workspace_authorization" | "runtime_approval" | "human_input" | "change_review" | null;
            readonly phase: string;
            readonly session_id: string;
            /** Format: date-time */
            readonly started_at: string | null;
            /** @enum {string} */
            readonly status: "disabled" | "ready" | "running" | "waiting_human" | "blocked" | "paused" | "completed" | "failed";
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly CommentRequest: {
            readonly comment: string;
        };
        readonly ConfirmDagProposalRequest: {
            readonly confirmed_by?: string;
            /** @description Start the compiled Agent DAG immediately after confirmation. */
            readonly start?: boolean;
        };
        readonly ConfirmDagProposalResponse: {
            readonly message: Record<string, never>;
            readonly proposal: components["schemas"]["DagProposalRecord"];
            readonly session: Record<string, never>;
        };
        readonly ConversationIntentEvaluationResult: {
            readonly accuracy: number;
            readonly average_confidence: number;
            readonly cases: readonly {
                /** @enum {string} */
                readonly actual_intent: "capture_goal" | "clarify" | "ask_status" | "add_constraint" | "ask_draft" | "ask_plan" | "ask_revise" | "ask_confirm" | "ask_run";
                readonly confidence: number;
                /** @enum {string} */
                readonly expected_intent: "capture_goal" | "clarify" | "ask_status" | "add_constraint" | "ask_draft" | "ask_plan" | "ask_revise" | "ask_confirm" | "ask_run";
                readonly fixture_id: string;
                readonly passed: boolean;
            }[];
            /** Format: date-time */
            readonly evaluated_at: string;
            readonly memory_operations: {
                readonly accuracy: number;
                readonly cases: readonly {
                    /** @enum {string} */
                    readonly actual_operation: "create" | "update" | "supersede" | "delete" | "ignore";
                    /** @enum {string} */
                    readonly expected_operation: "create" | "update" | "supersede" | "delete" | "ignore";
                    readonly fixture_id: string;
                    readonly passed: boolean;
                }[];
                readonly passed: number;
                readonly per_operation: readonly {
                    readonly accuracy: number;
                    /** @enum {string} */
                    readonly operation: "create" | "update" | "supersede" | "delete" | "ignore";
                    readonly passed: number;
                    readonly total: number;
                }[];
                readonly total: number;
            };
            readonly passed: number;
            readonly per_intent: readonly {
                readonly accuracy: number;
                /** @enum {string} */
                readonly intent: "capture_goal" | "clarify" | "ask_status" | "add_constraint" | "ask_draft" | "ask_plan" | "ask_revise" | "ask_confirm" | "ask_run";
                readonly passed: number;
                readonly total: number;
            }[];
            /** @constant */
            readonly schema_version: 1;
            readonly suite: string;
            readonly total: number;
        };
        readonly CoreMemorySnapshot: {
            readonly character_budget: number;
            /** Format: date-time */
            readonly created_at: string;
            readonly digest: string;
            readonly entries: readonly components["schemas"]["CoreMemorySnapshotEntry"][];
            readonly estimated_token_budget: number;
            readonly memory_versions: {
                readonly [key: string]: number;
            };
            readonly owner_principal_id: string;
            readonly project_binding: {
                /** Format: date-time */
                readonly bound_at: string;
                readonly project_id: string;
            } | null;
            readonly project_entries: readonly components["schemas"]["CoreMemorySnapshotEntry"][];
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly snapshot_id: string;
            readonly workspace_id: string;
        };
        readonly CoreMemorySnapshotEntry: {
            readonly confidence: number;
            readonly content: string;
            readonly importance: number;
            readonly kind: components["schemas"]["MemoryKind"];
            readonly memory_id: string;
            readonly memory_version: number;
            readonly scope_id: string;
            readonly scope_kind: components["schemas"]["MemoryScopeKind"];
            /** @enum {string} */
            readonly sensitivity: "normal" | "private";
            readonly source: components["schemas"]["MemorySource"];
            readonly tags: readonly string[];
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly CreateDagProposalRequest: {
            readonly dag_definition?: components["schemas"]["DagDefinition"];
            readonly inputs?: Record<string, never>;
            readonly orchestration_decision?: components["schemas"]["OrchestrationDecision"];
            /** @enum {string} */
            readonly source_kind?: "template" | "model" | "manual";
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
        readonly CreateGovernanceChangeRequest: {
            readonly action: components["schemas"]["GovernanceProtectedAction"];
            readonly payload?: {
                readonly [key: string]: unknown;
            };
            readonly reason: string;
            readonly resource_id: string;
        };
        readonly CreateMemoryCandidateRequest: {
            /** @enum {string} */
            readonly autonomy_mode?: "review_first" | "assisted" | "autopilot";
            readonly proposed_memory: components["schemas"]["CreateMemoryRequest"];
            readonly rationale?: string;
            readonly risk?: components["schemas"]["MemoryCandidateRisk"];
        };
        readonly CreateMemoryRequest: components["schemas"]["MemoryWriteFields"] & Record<string, never>;
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
        readonly DagDefinition: {
            /** Format: date-time */
            readonly created_at: string;
            readonly definition_id: string;
            readonly initial_state: {
                readonly [key: string]: unknown;
            };
            readonly metadata: {
                readonly [key: string]: unknown;
            };
            readonly nodes: readonly components["schemas"]["DagDefinitionNode"][];
            readonly objective: string;
            readonly policy: {
                readonly [key: string]: unknown;
            };
            readonly revision: number;
            /** @constant */
            readonly schema_version: 1;
            readonly source: {
                /** @enum {string} */
                readonly kind: "template" | "model" | "manual";
                readonly message_id: string | null;
                readonly template_id: string | null;
            };
            readonly state_schema: {
                readonly [key: string]: unknown;
            };
            readonly title: string;
        };
        readonly DagDefinitionAgentSelector: {
            readonly agent_id: string | null;
            readonly agent_version: number | null;
            readonly capability_tags: readonly string[];
            readonly role: components["schemas"]["AgentRole"] | null;
        };
        readonly DagDefinitionNode: {
            readonly acceptance_criteria?: readonly string[];
            readonly agent_selector: components["schemas"]["DagDefinitionAgentSelector"] | null;
            readonly allowed_skills: readonly string[];
            readonly allowed_tools: readonly string[];
            /** @enum {string} */
            readonly autonomy_mode: "review_first" | "assisted" | "autopilot";
            readonly condition: {
                /** @enum {string} */
                readonly operator: "exists" | "truthy" | "equals" | "not_equals" | "contains";
                readonly path: string;
                readonly value?: unknown;
            } | null;
            readonly depends_on: readonly string[];
            readonly human_gate: {
                readonly auto_resume: boolean;
                /** @enum {string} */
                readonly gate_type: "approval" | "input";
                readonly input_schema: {
                    readonly [key: string]: unknown;
                };
                readonly prompt: string;
            } | null;
            readonly input_contract: {
                readonly [key: string]: unknown;
            };
            /** @enum {string} */
            readonly join_policy: "all" | "any" | "quorum";
            readonly join_quorum: number | null;
            /** @enum {string} */
            readonly kind: "agent_task" | "reviewer" | "human_gate" | "condition" | "fanout" | "combine" | "end";
            readonly max_runtime_seconds: number | null;
            readonly max_tool_rounds: number | null;
            readonly metadata: {
                readonly [key: string]: unknown;
            };
            readonly name: string;
            readonly node_id: string;
            readonly objective: string;
            readonly output_contract: {
                readonly [key: string]: unknown;
            };
            readonly retry_policy: {
                readonly backoff_seconds: number;
                readonly max_attempts: number;
            };
            readonly reviewer_node_id: string | null;
            readonly state_input: {
                readonly [key: string]: string;
            };
            readonly state_output: readonly {
                /** @enum {string} */
                readonly reducer: "replace" | "merge" | "append";
                readonly source_path: string;
                readonly target_path: string;
            }[];
            readonly verification_steps?: readonly string[];
        };
        readonly DagProposalAssignment: {
            readonly agent_id: string | null;
            readonly allowed_skills: readonly string[];
            readonly allowed_tools: readonly string[];
            readonly input_context: string | null;
            readonly metadata: Record<string, never>;
            readonly model: string | null;
            readonly node_id: string;
            readonly node_name: string | null;
            readonly output_contract: string | null;
            readonly provider: string | null;
        };
        readonly DagProposalPlannerContext: {
            readonly fallback_reason: string | null;
            readonly fallback_used: boolean;
            readonly model: string | null;
            readonly orchestrator_agent_id: string | null;
            readonly provider_id: string | null;
            readonly system_prompt_summary: string | null;
        };
        readonly DagProposalRecord: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
            readonly checklist: readonly string[];
            readonly compiled_agent_dag_id: string | null;
            /** Format: date-time */
            readonly compiled_at: string | null;
            /** Format: date-time */
            readonly confirmed_at: string | null;
            readonly confirmed_by: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly dag_definition: components["schemas"]["DagDefinition"] | null;
            readonly dag_draft: Record<string, never>;
            readonly metadata: Record<string, never>;
            readonly mission_id: string;
            readonly mission_spec_contract: Record<string, never> | null;
            readonly orchestration_decision: components["schemas"]["OrchestrationDecision"] | null;
            readonly orchestrator_agent_id: string | null;
            readonly planner_context: components["schemas"]["DagProposalPlannerContext"];
            readonly proposal_id: string;
            /** @constant */
            readonly protocol_version: 1;
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
        readonly DashboardCostAttributionGroup: {
            /** @enum {string} */
            readonly cost_completeness: "complete" | "partial" | "unavailable";
            /** @enum {string} */
            readonly cost_source: "provider_reported" | "estimated" | "mixed" | "unavailable";
            readonly costed_jobs: number;
            readonly effective_costs: components["schemas"]["DashboardMoneyTotals"];
            readonly estimated_costs: components["schemas"]["DashboardMoneyTotals"];
            readonly failed_jobs: number;
            readonly key: string;
            readonly label: string;
            readonly model_jobs: number;
            readonly provider_reported_costs: components["schemas"]["DashboardMoneyTotals"];
            readonly retry_attempts: number;
            readonly run_count: number;
            readonly total_tokens: number | null;
            readonly unavailable_jobs: number;
            readonly usage_records: number;
        };
        readonly DashboardCostReport: {
            /** @constant */
            readonly basis: "provider_reported_preferred";
            readonly by_agent: readonly components["schemas"]["DashboardCostAttributionGroup"][];
            readonly by_provider_model: readonly components["schemas"]["DashboardCostAttributionGroup"][];
            readonly by_work_package: readonly components["schemas"]["DashboardCostAttributionGroup"][];
            readonly coverage: {
                /** @enum {string} */
                readonly cost_completeness: "complete" | "partial" | "unavailable";
                readonly costed_jobs: number;
                readonly estimated_only_jobs: number;
                readonly model_jobs: number;
                readonly provider_reported_jobs: number;
                readonly runs_observed: number;
                readonly unavailable_jobs: number;
            };
            readonly totals: {
                readonly effective_costs: components["schemas"]["DashboardMoneyTotals"];
                readonly estimated_costs: components["schemas"]["DashboardMoneyTotals"];
                readonly provider_reported_costs: components["schemas"]["DashboardMoneyTotals"];
            };
        };
        readonly DashboardMoneyTotals: {
            readonly [key: string]: string;
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
            readonly index_schema_version: 2;
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
                readonly cost_report: components["schemas"]["DashboardCostReport"];
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
            readonly provider_connection_id?: string;
            /** @enum {string} */
            readonly runtime?: "local" | "docker-worker" | "codex" | "claude-sdk" | "kimi" | "glm";
        };
        readonly Error: {
            readonly code: string;
            readonly details?: {
                readonly [key: string]: unknown;
            };
            readonly domain: string;
            readonly message: string;
            readonly remediation: string;
            readonly retryable: boolean;
            /** @enum {string} */
            readonly severity: "info" | "warning" | "error" | "critical";
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
        readonly ExecutionReplayResult: {
            /** Format: date-time */
            readonly completed_at: string | null;
            readonly frozen_input: {
                readonly allowed_skills: readonly string[];
                readonly allowed_tools: readonly string[];
                readonly input_keys: readonly string[];
                readonly intent: string;
            };
            readonly idempotency_key: string;
            readonly identity_digest: string;
            readonly last_error: string | null;
            readonly lineage_event_ids: readonly string[];
            readonly node_run_id: string;
            readonly plan_identity: {
                readonly node_id: string;
                readonly node_run_id: string;
                readonly template_id: string;
                readonly template_version: number;
            };
            readonly replay_attempt: number | null;
            readonly replay_id: string;
            readonly replay_job_id: string | null;
            /** Format: date-time */
            readonly requested_at: string;
            readonly requested_by: string;
            readonly run_id: string;
            readonly runtime_identity: {
                readonly agent_runtime: string;
                readonly harness_profile: string | null;
                readonly runtime_agent_ref: string | null;
                readonly target_kind: string;
            };
            /** @constant */
            readonly schema_version: 1;
            readonly source_attempt: number;
            readonly source_job_id: string;
            /** @enum {string} */
            readonly status: "requested" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly GovernanceApprovalRecord: {
            readonly comment: string | null;
            /** Format: date-time */
            readonly decided_at: string;
            /** @enum {string} */
            readonly decision: "approved" | "rejected";
            readonly principal_id: string;
        };
        readonly GovernanceChangeListResponse: {
            readonly items: readonly components["schemas"]["GovernanceChangeRecord"][];
            readonly policy: components["schemas"]["GovernancePolicyRecord"];
        };
        readonly GovernanceChangeRecord: {
            readonly action: components["schemas"]["GovernanceProtectedAction"];
            readonly allow_self_approval: boolean;
            /** Format: date-time */
            readonly applied_at: string | null;
            readonly applied_by: string | null;
            readonly approvals: readonly components["schemas"]["GovernanceApprovalRecord"][];
            /** Format: date-time */
            readonly approved_at: string | null;
            readonly base_digest: string;
            readonly change_id: string;
            readonly conflict_reason: string | null;
            readonly payload: {
                readonly [key: string]: unknown;
            };
            readonly payload_digest: string;
            /** Format: date-time */
            readonly proposed_at: string;
            readonly proposed_by: string;
            readonly reason: string;
            readonly required_approvals: number;
            readonly resource_id: string;
            /** @enum {string} */
            readonly resource_type: "agent" | "skill" | "template";
            readonly result: {
                readonly [key: string]: unknown;
            } | null;
            /** @constant */
            readonly schema_version: 1;
            readonly status: components["schemas"]["GovernanceChangeStatus"];
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly GovernanceChangeStatus: "pending" | "approved" | "rejected" | "applied" | "conflicted";
        readonly GovernanceDecisionRequest: {
            readonly comment?: string;
        };
        /** @enum {string} */
        readonly GovernanceMode: "advisory" | "enforced";
        readonly GovernancePolicyRecord: {
            readonly allow_self_approval: boolean;
            /** Format: date-time */
            readonly created_at: string;
            readonly mode: components["schemas"]["GovernanceMode"];
            readonly protected_actions: readonly components["schemas"]["GovernanceProtectedAction"][];
            readonly required_approvals: number;
            /** @constant */
            readonly schema_version: 1;
            /** Format: date-time */
            readonly updated_at: string;
            readonly updated_by: string;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly GovernanceProtectedAction: "agent.upsert" | "agent.disable" | "skill.upsert" | "skill.disable" | "template.publish" | "template.archive";
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
            readonly agent_id: string | null;
            readonly allowed_skills: readonly string[];
            readonly allowed_tools: readonly string[];
            readonly input_context: string | null;
            readonly metadata: Record<string, never>;
            readonly model: string | null;
            readonly node_id: string;
            readonly node_name: string | null;
            readonly output_contract: string | null;
            readonly provider: string | null;
        };
        readonly LegacyDagProposalPlannerContext: {
            readonly fallback_reason: string | null;
            readonly fallback_used: boolean;
            readonly model: string | null;
            readonly orchestrator_agent_id: string | null;
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
            readonly orchestrator_agent_id?: string | null;
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
        readonly LocalProject: {
            /** Format: date-time */
            readonly archived_at: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly default_output_relative_path: string;
            readonly description: string | null;
            readonly name: string;
            readonly project_id: string;
            /** @enum {string} */
            readonly status: "active" | "archived" | "unavailable";
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly LocalProjectListResponse: {
            readonly items: readonly components["schemas"]["LocalProject"][];
        };
        readonly LongTaskRuntimeState: {
            /** @enum {string} */
            readonly cost_status: "unavailable" | "partial" | "complete";
            readonly cumulative_costs: {
                readonly [key: string]: string;
            };
            readonly cumulative_estimated_input_tokens: number;
            readonly cumulative_input_tokens: number;
            readonly cumulative_output_tokens: number;
            readonly cumulative_reported_input_tokens: number;
            readonly cumulative_total_tokens: number;
            readonly elapsed_ms: number;
            readonly exhausted: boolean;
            /** @enum {string|null} */
            readonly exhausted_reason: "wall_time" | "turn_attempts" | "total_tokens" | null;
            /** @enum {string} */
            readonly input_token_accounting: "reported" | "estimated" | "mixed" | "unavailable";
            readonly max_total_tokens: number;
            readonly max_turn_attempts: number;
            readonly max_wall_time_ms: number;
            readonly resume_attempts: number;
            /** @constant */
            readonly schema_version: 1;
            /** Format: date-time */
            readonly started_at: string;
            readonly turn_attempts: number;
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly McpConnectorPreset: {
            readonly description: string;
            /** Format: uri */
            readonly documentation_url: string;
            readonly name: string;
            readonly preset_id: string;
            readonly provider: string;
            /** @constant */
            readonly schema_version: 1;
            readonly secrets: readonly components["schemas"]["McpConnectorPresetSecret"][];
            readonly server: components["schemas"]["UpsertMcpServerRequest"];
            /** @enum {string} */
            readonly transport: "stdio" | "streamable-http";
        };
        readonly McpConnectorPresetSecret: {
            readonly description: string;
            /** Format: uri */
            readonly help_url: string | null;
            readonly label: string;
            readonly name: string;
            readonly placeholder: string;
            readonly required: boolean;
        };
        readonly McpDiscoveredTool: {
            readonly capability_id: string;
            readonly description: string;
            readonly destructive: boolean;
            readonly read_only: boolean;
            /** @enum {string} */
            readonly risk_level: "T0" | "T1" | "T2" | "T3";
            readonly tool_name: string;
        };
        readonly McpServer: {
            readonly args: readonly string[];
            readonly command: string | null;
            readonly connect_timeout_ms: number;
            /** Format: date-time */
            readonly created_at: string;
            /** @enum {string|null} */
            readonly default_risk_level: "T0" | "T1" | "T2" | "T3" | null;
            readonly description: string | null;
            readonly discovered_tools: readonly components["schemas"]["McpDiscoveredTool"][];
            readonly enabled: boolean;
            readonly environment: {
                readonly [key: string]: string;
            };
            readonly headers: {
                readonly [key: string]: string;
            };
            /** Format: date-time */
            readonly last_connected_at: string | null;
            readonly last_error: string | null;
            readonly name: string;
            /** @constant */
            readonly schema_version: 1;
            readonly secret_configured: boolean;
            readonly secret_names: readonly string[];
            readonly server_id: string;
            readonly server_version: {
                readonly name: string;
                readonly version: string;
            } | null;
            /** @enum {string} */
            readonly status: "disabled" | "disconnected" | "connecting" | "ready" | "error";
            readonly tool_filter: {
                readonly exclude: readonly string[];
                readonly include: readonly string[];
            };
            readonly tool_risk_overrides: {
                readonly [key: string]: "T0" | "T1" | "T2" | "T3";
            };
            readonly tool_timeout_ms: number;
            /** @enum {string} */
            readonly transport: "stdio" | "streamable-http";
            /** Format: date-time */
            readonly updated_at: string;
            readonly url: string | null;
            readonly workspace_id: string;
        };
        readonly MemoryBackupMetadata: {
            readonly backup_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly encrypted_bytes: number;
            /** Format: date-time */
            readonly expires_at: string | null;
            readonly manifest_digest: string;
            readonly record_count: number;
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly MemoryCandidateOperation: "create" | "update" | "delete";
        readonly MemoryCandidateRecord: {
            /** @enum {string} */
            readonly autonomy_mode: "review_first" | "assisted" | "autopilot";
            readonly candidate_id: string;
            readonly committed_memory_id: string | null;
            readonly operation: components["schemas"]["MemoryCandidateOperation"];
            /** Format: date-time */
            readonly proposed_at: string;
            readonly proposed_by: string;
            readonly proposed_memory: components["schemas"]["MemoryProposal"] | null;
            readonly rationale: string;
            readonly resolution_note: string | null;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly resolved_by: string | null;
            readonly risk: components["schemas"]["MemoryCandidateRisk"];
            /** @constant */
            readonly schema_version: 1;
            readonly source: components["schemas"]["MemorySource"];
            readonly status: components["schemas"]["MemoryCandidateStatus"];
            readonly target_memory_id: string | null;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly MemoryCandidateRisk: "low" | "medium" | "high";
        /** @enum {string} */
        readonly MemoryCandidateStatus: "pending" | "approved" | "rejected";
        readonly MemoryCollection: {
            readonly collection_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            /** @enum {string} */
            readonly kind: "team" | "organization";
            readonly member_workspace_ids: readonly string[];
            readonly name: string;
            readonly owner_workspace_id: string;
            /** @constant */
            readonly schema_version: 1;
            /** @enum {string} */
            readonly status: "active" | "archived";
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly MemoryConflictRecord: {
            readonly base_memory_version: number;
            readonly conflict_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly current_content: string;
            readonly external_id: string | null;
            readonly external_version: string | null;
            /** @enum {string} */
            readonly kind: "shared_suggestion" | "external_update";
            readonly proposed_by: string;
            readonly proposed_content: string;
            readonly proposed_deleted: boolean;
            readonly proposed_kind: components["schemas"]["MemoryKind"];
            readonly proposed_tags: readonly string[];
            /** @enum {string|null} */
            readonly resolution: "accept_proposed" | "keep_current" | "merge" | "dismiss" | null;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly resolved_by: string | null;
            readonly resolved_memory_version: number | null;
            /** @constant */
            readonly schema_version: 1;
            readonly share_id: string | null;
            readonly source_id: string | null;
            /** @enum {string} */
            readonly status: "pending" | "resolved" | "dismissed";
            readonly target_memory_id: string;
            readonly workspace_id: string;
        };
        readonly MemoryEffectiveness: {
            readonly acceptance_rate: number;
            readonly accepted_recommendations: number;
            readonly applied_memories: number;
            readonly context_last_latency_ms: number | null;
            readonly context_total_latency_ms: number;
            readonly correlation_note: string;
            readonly dismissal_rate: number;
            readonly dismissed_recommendations: number;
            /** Format: date-time */
            readonly evaluated_at: string;
            readonly evaluated_tasks: number;
            readonly evaluated_tasks_with_memory: number;
            readonly evaluation_join_rate: number;
            readonly not_relevant_recommendations: number;
            readonly recommendation_feedback: number;
            /** @constant */
            readonly schema_version: 1;
            readonly stale_overlays: number;
            readonly turn_contexts: number;
            readonly workspace_id: string;
        };
        readonly MemoryEmbeddingProviderStatus: {
            readonly cached_vectors: number;
            readonly dimensions: number | null;
            readonly fingerprint: string | null;
            readonly last_error: string | null;
            readonly model: string | null;
            readonly provider_id: string;
            /** @enum {string} */
            readonly state: "disabled" | "ready" | "degraded";
        };
        readonly MemoryExternalSource: {
            readonly collection_id: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly last_cursor: string | null;
            readonly last_error: string | null;
            /** Format: date-time */
            readonly last_sync_at: string | null;
            readonly name: string;
            /** @enum {string} */
            readonly provider: "mcp" | "push";
            /** @constant */
            readonly schema_version: 1;
            readonly server_id: string | null;
            readonly source_id: string;
            /** @enum {string} */
            readonly status: "active" | "disabled" | "degraded";
            readonly tool_arguments: {
                readonly [key: string]: unknown;
            };
            readonly tool_name: string | null;
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly MemoryImportRequest: {
            /** @default false */
            readonly dry_run?: boolean;
            readonly memories?: readonly {
                readonly [key: string]: unknown;
            }[];
            readonly payload?: unknown;
            /**
             * @default skip
             * @enum {string}
             */
            readonly strategy?: "skip" | "merge" | "replace";
        } & {
            readonly [key: string]: unknown;
        };
        readonly MemoryImportResult: {
            readonly created: number;
            readonly dry_run: boolean;
            readonly errors: readonly {
                readonly index: number;
                readonly message: string;
            }[];
            readonly memory_ids: readonly string[];
            readonly rejected: number;
            readonly skipped: number;
            /** @enum {string} */
            readonly strategy: "skip" | "merge" | "replace";
            readonly total: number;
            readonly updated: number;
        };
        readonly MemoryIntegrityReport: {
            readonly checked_records: number;
            readonly encrypted_records: number;
            readonly invalid_records: number;
            readonly issues: readonly {
                readonly code: string;
                readonly record_id: string | null;
                readonly record_type: string;
            }[];
            readonly orphan_references: number;
            readonly report_id: string;
            /** Format: date-time */
            readonly scanned_at: string;
            /** @constant */
            readonly schema_version: 1;
            /** @enum {string} */
            readonly status: "healthy" | "degraded";
            readonly workspace_id: string;
        };
        readonly MemoryKeyStatus: {
            /** Format: date-time */
            readonly active_key_created_at: string;
            readonly active_key_id: string;
            /** Format: date-time */
            readonly last_rotated_at: string | null;
            readonly retained_key_count: number;
            /** @enum {string} */
            readonly root_source: "environment" | "local_file";
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly MemoryKind: "preference" | "fact" | "convention" | "decision" | "lesson";
        readonly MemoryKnowledgeProviderStatus: {
            /** @constant */
            readonly canonical_source: "my_mate_memory_records";
            readonly last_error: string | null;
            readonly palace_path: string | null;
            /** @enum {string} */
            readonly provider_id: "disabled" | "mempalace";
            readonly read_only: boolean;
            /** @enum {string} */
            readonly state: "disabled" | "ready" | "unavailable" | "degraded";
        };
        readonly MemoryKnowledgeQueryRequest: {
            /** Format: date-time */
            readonly as_of?: string | null;
            readonly entity: string;
            /** @default 25 */
            readonly limit?: number;
        };
        readonly MemoryKnowledgeQueryResult: {
            readonly count: number;
            readonly entity: string;
            readonly provider: components["schemas"]["MemoryKnowledgeProviderStatus"];
            readonly relations: readonly components["schemas"]["MemoryKnowledgeRelation"][];
        };
        readonly MemoryKnowledgeRelation: {
            readonly memory_id: string | null;
            readonly object: string;
            readonly predicate: string;
            readonly subject: string;
            /** Format: date-time */
            readonly valid_from: string | null;
            /** Format: date-time */
            readonly valid_until: string | null;
        };
        readonly MemoryMaintenanceResult: {
            readonly canonical_memories: number;
            /** Format: date-time */
            readonly completed_at: string;
            readonly duration_ms: number;
            readonly expired_memories: number;
            readonly private_candidates_migrated: number;
            readonly private_memories_migrated: number;
            readonly pruned_candidates: number;
            readonly retrieval_rebuilt: boolean;
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        readonly MemoryMaintenanceSweepResult: {
            /** Format: date-time */
            readonly completed_at: string;
            readonly failed_workspaces: readonly {
                readonly error: string;
                readonly workspace_id: string;
            }[];
            readonly maintained_workspaces: number;
            readonly results: readonly components["schemas"]["MemoryMaintenanceResult"][];
            /** @constant */
            readonly schema_version: 1;
            readonly skipped_workspaces: number;
            readonly workspace_count: number;
        };
        readonly MemoryObservability: {
            readonly automatic_recall_cache_hits: number;
            readonly automatic_recall_cache_misses: number;
            readonly automatic_recall_failures: number;
            readonly automatic_recall_hits: number;
            readonly automatic_recall_last_latency_ms: number | null;
            readonly automatic_recall_queries: number;
            readonly automatic_recall_total_latency_ms: number;
            readonly background_candidates: number;
            readonly background_commits: number;
            readonly background_reviews: number;
            readonly candidates_approved: number;
            readonly candidates_rejected: number;
            readonly embedding_fallbacks: number;
            readonly embedding_hits: number;
            readonly exported_memories: number;
            readonly imported_memories: number;
            readonly index_rebuilds: number;
            readonly intent_model_attempts: number;
            readonly intent_model_fallbacks: number;
            readonly intent_model_successes: number;
            /** Format: date-time */
            readonly last_maintenance_at: string | null;
            /** Format: date-time */
            readonly last_query_at: string | null;
            /** Format: date-time */
            readonly last_review_at: string | null;
            readonly lexical_hits: number;
            readonly maintenance_runs: number;
            readonly maintenance_sweeps: number;
            readonly maintenance_workspace_failures: number;
            readonly model_extraction_attempts: number;
            readonly model_extraction_fallbacks: number;
            readonly model_extraction_successes: number;
            readonly model_proposed_creates: number;
            readonly model_proposed_deletes: number;
            readonly model_proposed_supersedes: number;
            readonly model_proposed_updates: number;
            readonly ngram_hits: number;
            readonly private_candidate_migrations: number;
            readonly private_memory_migrations: number;
            readonly retrieval_failures: number;
            readonly retrieval_last_latency_ms: number | null;
            readonly retrieval_queries: number;
            readonly retrieval_total_latency_ms: number;
            /** @constant */
            readonly schema_version: 1;
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly MemoryOnboarding: {
            readonly candidate_ids: readonly string[];
            readonly committed_memory_ids: readonly string[];
            /** Format: date-time */
            readonly completed_at: string | null;
            /** Format: date-time */
            readonly dismissed_at: string | null;
            readonly draft_entries: readonly {
                readonly content: string;
                readonly kind: components["schemas"]["MemoryKind"];
                /** @enum {string} */
                readonly origin: "explicit" | "inferred";
                readonly scope_id: string | null;
                /** @enum {string} */
                readonly scope_kind: "user" | "workspace" | "project";
                /** @enum {string} */
                readonly sensitivity: "normal" | "private";
                readonly tags: readonly string[];
            }[];
            readonly principal_id: string;
            /** @constant */
            readonly schema_version: 1;
            /** Format: date-time */
            readonly started_at: string | null;
            /** @enum {string} */
            readonly status: "not_started" | "in_progress" | "completed" | "dismissed";
            readonly step: number;
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly MemoryOperationsStatus: {
            readonly backups: readonly components["schemas"]["MemoryBackupMetadata"][];
            readonly key: components["schemas"]["MemoryKeyStatus"];
            readonly last_integrity: components["schemas"]["MemoryIntegrityReport"] | null;
            readonly retention: components["schemas"]["MemorySettings"]["retention"];
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        readonly MemoryOverlay: {
            /** Format: date-time */
            readonly consumed_at: string | null;
            readonly consumed_context_id: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly entry: components["schemas"]["TurnMemoryContextEntry"];
            readonly memory_id: string;
            readonly memory_version: number;
            /** @enum {string} */
            readonly mode: "next_turn" | "session";
            readonly overlay_id: string;
            /** Format: date-time */
            readonly revoked_at: string | null;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            /** @enum {string} */
            readonly status: "queued" | "active" | "consumed" | "revoked" | "stale";
            readonly workspace_id: string;
        };
        readonly MemoryProposal: {
            readonly confidence: number;
            readonly content: string;
            /** Format: date-time */
            readonly expires_at: string | null;
            readonly importance: number;
            readonly kind: components["schemas"]["MemoryKind"];
            readonly scope_id: string;
            readonly scope_kind: components["schemas"]["MemoryScopeKind"];
            readonly sensitivity: components["schemas"]["MemorySensitivity"];
            readonly source: components["schemas"]["MemorySource"];
            readonly supersedes_memory_id: string | null;
            readonly tags: readonly string[];
            /** Format: date-time */
            readonly valid_from: string | null;
            /** Format: date-time */
            readonly valid_until: string | null;
        };
        readonly MemoryPurgeResult: {
            /** Format: date-time */
            readonly completed_at: string;
            readonly cryptographic_erasure: boolean;
            readonly knowledge_rebuilt: boolean;
            readonly memory_id: string;
            readonly purge_id: string;
            readonly removed_by_type: {
                readonly [key: string]: number;
            };
            readonly removed_records: number;
            readonly retrieval_rebuilt: boolean;
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        readonly MemoryRecommendation: {
            readonly already_in_snapshot: boolean;
            /** @enum {string} */
            readonly application_state: "available" | "queued" | "kept" | "applied" | "dismissed";
            readonly applied_automatically: boolean;
            readonly available_actions: readonly ("use_next_turn" | "keep_for_session" | "dismiss_for_session" | "not_relevant" | "edit_requested" | "forget_requested")[];
            readonly kind: components["schemas"]["MemoryKind"];
            readonly last_applied_context_id: string | null;
            readonly memory_id: string;
            readonly memory_version: number;
            readonly reason: string;
            readonly recommendation_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly scope_id: string;
            readonly scope_kind: components["schemas"]["MemoryScopeKind"];
            readonly score: number;
            /** @enum {string} */
            readonly sensitivity: "normal" | "private";
            readonly session_id: string;
            readonly snapshot_version: number | null;
            readonly summary: string;
            readonly title: string;
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly MemoryRecommendationFeedback: {
            /** @enum {string} */
            readonly action: "use_next_turn" | "keep_for_session" | "dismiss_for_session" | "not_relevant" | "edit_requested" | "forget_requested";
            readonly actor_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly feedback_id: string;
            readonly memory_id: string;
            readonly memory_version: number;
            /** @enum {string|null} */
            readonly reason_code: "useful" | "wrong_task" | "outdated" | "incorrect" | "too_sensitive" | "other" | null;
            readonly recommendation_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly workspace_id: string;
        };
        readonly MemoryRecommendationResult: {
            readonly count: number;
            readonly recommendations: readonly components["schemas"]["MemoryRecommendation"][];
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
        };
        readonly MemoryRecord: components["schemas"]["MemoryProposal"] & {
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly memory_id: string;
            /** @constant */
            readonly schema_version: 1;
            readonly status: components["schemas"]["MemoryStatus"];
            /** Format: date-time */
            readonly updated_at: string;
            readonly updated_by: string;
            readonly version: number;
            readonly workspace_id: string;
        };
        readonly MemoryRestoreResult: {
            readonly backup_id: string;
            /** Format: date-time */
            readonly completed_at: string;
            readonly dry_run: boolean;
            readonly restored_records: number;
            /** @constant */
            readonly schema_version: 1;
            readonly skipped_records: number;
            readonly verified_digest: boolean;
            readonly workspace_id: string;
        };
        readonly MemoryRetentionRunResult: {
            /** Format: date-time */
            readonly completed_at: string;
            readonly pruned_backups: number;
            readonly pruned_contexts: number;
            readonly pruned_feedback: number;
            readonly purged_memories: number;
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        readonly MemoryRetrievalEvidence: {
            readonly fused_score: number;
            readonly lexical_rank: number | null;
            readonly lexical_score: number;
            readonly matched_by: readonly ("lexical" | "ngram" | "embedding")[];
            readonly semantic_rank: number | null;
            readonly semantic_score: number;
        };
        readonly MemoryRetrievalHit: {
            readonly evidence: components["schemas"]["MemoryRetrievalEvidence"];
            readonly memory: components["schemas"]["MemoryRecord"];
        };
        readonly MemoryRetrievalIndexStatus: {
            readonly active_records: number;
            readonly database_bytes: number;
            readonly embedding: components["schemas"]["MemoryEmbeddingProviderStatus"];
            readonly indexed_records: number;
            readonly journal_records: number;
            /** Format: date-time */
            readonly last_rebuilt_at: string | null;
            readonly retrieval: components["schemas"]["MemoryRetrievalMode"];
            /** @constant */
            readonly schema_version: 1;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly MemoryRetrievalMode: "hybrid_lexical_ngram_v1" | "hybrid_lexical_embedding_v1";
        readonly MemoryRetrievalRequest: {
            readonly kind?: components["schemas"]["MemoryKind"];
            /** @default 8 */
            readonly limit?: number;
            readonly query: string;
            readonly scope_id?: string;
            readonly scope_kind?: components["schemas"]["MemoryScopeKind"];
        };
        readonly MemoryRetrievalResult: {
            readonly count: number;
            readonly embedding_fallback: boolean;
            readonly hits: readonly components["schemas"]["MemoryRetrievalHit"][];
            readonly index_rebuilt: boolean;
            readonly query: string;
            readonly retrieval: components["schemas"]["MemoryRetrievalMode"];
            readonly workspace_id: string;
        };
        readonly MemoryReviewRecord: {
            readonly candidate_ids: readonly string[];
            readonly committed_memory_ids: readonly string[];
            /** @enum {string} */
            readonly extractor: "deterministic" | "model";
            readonly message_digest: string;
            readonly proposed_operations: {
                readonly create: number;
                readonly delete: number;
                readonly supersede: number;
                readonly update: number;
            };
            readonly provider_connection_id: string | null;
            readonly reason: string | null;
            /** Format: date-time */
            readonly reviewed_at: string;
            readonly reviewed_message_ids: readonly string[];
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            /** @enum {string} */
            readonly status: "completed" | "skipped" | "failed";
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly MemoryScopeKind: "user" | "workspace" | "project" | "agent";
        /** @enum {string} */
        readonly MemorySensitivity: "normal" | "private" | "restricted";
        readonly MemorySettings: {
            readonly automatic_recall: {
                readonly cache_ttl_seconds: number;
                readonly character_budget: number;
                readonly enabled: boolean;
                readonly max_results: number;
            };
            readonly background_review: {
                readonly enabled: boolean;
                readonly max_candidates_per_review: number;
                readonly min_user_characters: number;
            };
            readonly embedding: {
                readonly dimensions: number | null;
                readonly model: string | null;
                /** @enum {string} */
                readonly provider: "disabled" | "openai-compatible";
                readonly provider_connection_id: string | null;
            };
            readonly intelligence: {
                /** @enum {string} */
                readonly extraction_mode: "deterministic" | "hybrid";
                readonly intent_model_enabled: boolean;
                readonly max_turn_characters: number;
                readonly min_confidence: number;
                readonly model: string | null;
                readonly model_timeout_ms: number;
                readonly provider_connection_id: string | null;
            };
            readonly knowledge_graph: {
                readonly palace_path: string | null;
                /** @enum {string} */
                readonly provider: "disabled" | "mempalace";
                readonly python_bin: string | null;
                readonly sync_canonical: boolean;
            };
            readonly retention: {
                readonly backup_days: number;
                readonly expired_memory_days: number;
                readonly feedback_days: number;
                readonly journal_max_records: number;
                readonly maintenance_interval_minutes: number;
                readonly resolved_candidate_days: number;
                readonly soft_deleted_memory_days: number;
                readonly turn_context_days: number;
            };
            /** @constant */
            readonly schema_version: 1;
            readonly scope_policy: {
                readonly agent_memory_enabled: boolean;
                readonly project_memory_enabled: boolean;
            };
            /** Format: date-time */
            readonly updated_at: string;
            readonly updated_by: string;
            readonly workspace_id: string;
        };
        readonly MemoryShareGrant: {
            readonly collection_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            /** @enum {string} */
            readonly mode: "read_only" | "suggest_changes";
            readonly published_content: string;
            readonly published_digest: string;
            /** Format: date-time */
            readonly revoked_at: string | null;
            /** @constant */
            readonly schema_version: 1;
            readonly share_id: string;
            readonly source_memory_id: string;
            readonly source_memory_version: number;
            readonly source_workspace_id: string;
            /** @enum {string} */
            readonly status: "active" | "revoked";
            readonly target_workspace_ids: readonly string[];
            /** Format: date-time */
            readonly updated_at: string;
            /** @enum {string} */
            readonly version_policy: "pinned" | "follow_latest";
        };
        readonly MemorySource: {
            readonly action_id: string | null;
            readonly message_ids: readonly string[];
            readonly note: string | null;
            readonly origin: components["schemas"]["MemorySourceOrigin"];
            readonly provider_id: string | null;
            readonly session_id: string | null;
        };
        /** @enum {string} */
        readonly MemorySourceOrigin: "explicit_user" | "inferred" | "background_review" | "imported" | "system";
        /** @enum {string} */
        readonly MemoryStatus: "active" | "superseded" | "expired" | "deleted";
        readonly MemorySyncRun: {
            /** Format: date-time */
            readonly completed_at: string;
            readonly conflicts: number;
            readonly created: number;
            readonly cursor: string | null;
            readonly deleted: number;
            readonly error: string | null;
            readonly received: number;
            /** @constant */
            readonly schema_version: 1;
            readonly skipped: number;
            readonly source_id: string;
            /** @enum {string} */
            readonly status: "completed" | "partial" | "failed";
            readonly sync_id: string;
            readonly updated: number;
            readonly workspace_id: string;
        };
        readonly MemoryWriteFields: {
            readonly confidence?: number;
            readonly content?: string;
            /** Format: date-time */
            readonly expires_at?: string | null;
            readonly importance?: number;
            readonly kind?: components["schemas"]["MemoryKind"];
            readonly scope_id?: string;
            readonly scope_kind?: components["schemas"]["MemoryScopeKind"];
            readonly sensitivity?: components["schemas"]["MemorySensitivity"];
            readonly source?: {
                readonly [key: string]: unknown;
            };
            readonly supersedes_memory_id?: string | null;
            readonly tags?: readonly string[];
            /** Format: date-time */
            readonly valid_from?: string | null;
            /** Format: date-time */
            readonly valid_until?: string | null;
        };
        readonly MissionMaterializerConsistencyReport: {
            readonly checkpoint_sequence: number | null;
            readonly differing_sections: readonly ("missionSpec" | "missionSpecContract" | "missionSnapshot")[];
            readonly direct_projection_digest: string;
            readonly event_count: number;
            readonly last_sequence: number;
            readonly materialized_projection_digest: string;
            readonly session_id: string;
            readonly source_digest: string;
            /** @enum {string} */
            readonly status: "consistent" | "drifted";
            /** Format: date-time */
            readonly verified_at: string;
        };
        readonly MissionMaterializerRebuildResponse: components["schemas"]["MissionMaterializerStatus"] & {
            /** @constant */
            readonly rebuilt: true;
        };
        readonly MissionMaterializerStatus: {
            readonly checkpoint_sequence: number | null;
            readonly event_count: number;
            readonly last_sequence: number;
            /** Format: date-time */
            readonly materialized_at: string;
            /** @constant */
            readonly materializer_version: 1;
            readonly projection_digest: string;
            readonly session_id: string;
            readonly source_digest: string;
        };
        readonly MissionUiBlock: {
            readonly block_id: string;
            /** @enum {string} */
            readonly component: "task_guidance" | "decision_queue" | "progress_summary" | "result_gallery" | "quality_summary" | "repair_recommendation" | "conversation" | "technical_details";
            readonly data: Record<string, never>;
            readonly priority: number;
            readonly title: string;
            /** @enum {string} */
            readonly visibility: "primary" | "secondary" | "advanced";
        };
        readonly MissionUiPlan: {
            readonly blocks: readonly components["schemas"]["MissionUiBlock"][];
            /** @constant */
            readonly fallback_component: "task_guidance";
            /** Format: date-time */
            readonly generated_at: string;
            readonly phase: string;
            readonly primary_action: string | null;
            /** @constant */
            readonly version: 1;
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
            readonly agent_id: string | null;
            readonly attempt: number;
            readonly execution_ref: Record<string, never>;
            readonly finished_at: string | null;
            readonly name: string;
            readonly node_id: string;
            readonly node_run_id: string;
            readonly progress: Record<string, never>;
            readonly registry_provenance: components["schemas"]["RegistryProvenance"];
            readonly runtime_agent_ref: string | null;
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
            readonly routing_decisions?: readonly {
                readonly condition_matched: boolean;
                readonly condition_valid: boolean;
                readonly edge_key: string;
                readonly from_node_id: string;
                readonly from_port: string | null;
                readonly matched: boolean;
                readonly port_matched: boolean;
                readonly reason: string;
                readonly to_node_id: string;
                readonly to_port: string | null;
            }[];
            readonly run_id: string;
            readonly skipped_node_run_ids: readonly string[];
            /** @enum {string} */
            readonly source_outcome?: "completed" | "failed" | "cancelled" | "handoff";
            readonly summary: string | null;
            readonly synthetic?: boolean;
            /** @constant */
            readonly type: "node_handoff";
        };
        /** @enum {string} */
        readonly NodeStatus: "pending" | "ready" | "running" | "waiting_human" | "completed" | "failed" | "skipped" | "cancelled";
        readonly Notification: {
            readonly body: string;
            /** Format: date-time */
            readonly created_at: string;
            /** Format: date-time */
            readonly dismissed_at: string | null;
            /** @enum {string} */
            readonly kind: "schedule_completed" | "schedule_failed" | "approval_required" | "human_input_required";
            readonly notification_id: string;
            /** Format: date-time */
            readonly read_at: string | null;
            readonly resource_id: string | null;
            readonly resource_type: string | null;
            readonly schedule_id: string | null;
            readonly schedule_run_id: string | null;
            readonly session_id: string | null;
            /** @enum {string} */
            readonly severity: "info" | "success" | "warning" | "error";
            readonly title: string;
            readonly workspace_id: string;
        };
        readonly OrchestrationDecision: {
            readonly approval_required: boolean;
            /** Format: date-time */
            readonly created_at: string;
            readonly decision_id: string;
            readonly evidence?: {
                readonly matched_template_id?: string | null;
                readonly rationale: readonly string[];
                readonly scores: {
                    readonly direct: number;
                    readonly dynamic: number;
                    readonly manual: number;
                    readonly template: number;
                };
                readonly signals: readonly string[];
            };
            readonly mission_spec_id: string | null;
            /** @enum {string} */
            readonly mode: "direct" | "template" | "dynamic" | "manual";
            readonly policy_version?: string;
            readonly reason: string;
            readonly required_capabilities: readonly string[];
            readonly requires_dag: boolean;
            /** @enum {string} */
            readonly risk_level: "low" | "medium" | "high";
            /** @constant */
            readonly schema_version: 1;
            readonly selected_template_id: string | null;
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
            readonly agent_id: string | null;
            readonly agent_name: string | null;
            readonly node_id: string;
            readonly node_name: string;
            readonly reason: string;
            readonly runtime_agent_ref: string | null;
            readonly score: number;
            readonly skill_ids: readonly string[];
            readonly warnings: readonly string[];
        };
        readonly PlannerRegistryValidation: {
            readonly disabled_agent_count?: number;
            readonly disabled_skill_count?: number;
            readonly disallowed_skill_count?: number;
            readonly executable_node_count?: number;
            readonly missing_agent_count?: number;
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
                readonly agent_id: string | null;
                /** @enum {string} */
                readonly category: "required_input" | "registry" | "graph" | "other";
                /** @enum {string} */
                readonly code: "missing_required_input" | "missing_agent" | "unknown_agent" | "disabled_agent" | "unknown_skill" | "disabled_skill" | "disallowed_skill" | "no_ready_frontier" | "no_terminal_node";
                readonly field: string | null;
                readonly message: string;
                readonly node_id: string | null;
                readonly node_name: string | null;
                readonly skill_id: string | null;
            }[];
            readonly passed: boolean;
            /** @description Validation warnings. Includes required-input/DAG checks plus registry readiness checks for unknown or disabled Agents, unknown or disabled Skills, and Agent-denied Skills. */
            readonly warnings: readonly string[];
        };
        readonly ProviderConnection: {
            /** @enum {string} */
            readonly agent_runtime: "codex" | "claude-sdk" | "glm" | "kimi";
            readonly base_url: string | null;
            readonly connection_id: string;
            /** @default true */
            readonly context_compression_enabled: boolean;
            /** @default 75 */
            readonly context_compression_threshold_percent: number;
            /** Format: date-time */
            readonly created_at: string;
            readonly credential_configured: boolean;
            readonly credential_env: string;
            /** @enum {string} */
            readonly credential_source: "managed" | "environment";
            readonly default_model: string | null;
            /** @default 8 */
            readonly max_continuation_rounds: number;
            /** @default 524288 */
            readonly max_input_tokens: number;
            /** @default 65536 */
            readonly max_output_tokens: number;
            /** @default 32 */
            readonly max_tool_rounds: number;
            readonly metadata: Record<string, never>;
            readonly models: readonly string[];
            readonly name: string;
            /** @enum {string} */
            readonly protocol: "codex-appserver" | "anthropic-messages" | "openai-compatible";
            readonly provider: string;
            /** @enum {string} */
            readonly status: "active" | "disabled";
            /** Format: date-time */
            readonly updated_at: string;
            readonly verification: {
                readonly detail: string;
                readonly duration_ms: number;
                readonly model: string | null;
                /** @enum {string} */
                readonly status: "verified" | "failed";
                /** Format: date-time */
                readonly tested_at: string;
            } | null;
            readonly workspace_id: string;
        };
        readonly PublicWorkspaceBinding: {
            /** @enum {string} */
            readonly access: "snapshot-read" | "sandbox-write";
            readonly binding_id: string;
            readonly display_name: string;
            /** Format: date-time */
            readonly expires_at: string | null;
            /** @enum {string} */
            readonly scope: "run" | "session" | "persistent";
            readonly session_id: string;
            /** @enum {string} */
            readonly status: "active" | "expired" | "revoked" | "invalid";
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly PublishTemplateResponse: {
            readonly status: string;
            readonly template_id: string;
            readonly version: number;
        };
        readonly RegistryProvenance: {
            readonly agent_id_requested: string | null;
            readonly agent_id_resolved: string | null;
            /** @enum {string} */
            readonly agent_source: "registry" | "template_binding" | "fallback" | "none";
            /** @enum {string|null} */
            readonly agent_status: "active" | "disabled" | "missing" | null;
            /** @enum {string} */
            readonly runtime_agent_ref_source: "registry" | "template_binding" | "fallback" | "none";
            readonly skill_bindings: readonly {
                /** @enum {string|null} */
                readonly excluded_reason: "disallowed_by_agent" | "disabled" | "missing" | null;
                readonly included: boolean;
                /** @enum {string} */
                readonly registry_status: "active" | "disabled" | "missing";
                readonly skill_id: string;
                readonly sources: readonly ("agent_default" | "node_allowed")[];
            }[];
            readonly tool_bindings: readonly {
                readonly sources: readonly ("agent_allowed" | "node_allowed")[];
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
        readonly ResolveMemoryCandidateRequest: {
            readonly note?: string;
        };
        readonly ResumeTaskCheckpointRequest: {
            readonly model?: string;
            readonly provider_connection_id?: string;
        };
        readonly ResumeTaskCheckpointResponse: {
            readonly assistant_message: {
                readonly [key: string]: unknown;
            };
            readonly checkpoint: components["schemas"]["TaskCheckpoint"];
            readonly session: {
                readonly [key: string]: unknown;
            };
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
        /** @enum {string} */
        readonly RunStatus: "draft" | "queued" | "running" | "waiting_human" | "paused" | "blocked" | "completed" | "failed" | "cancelled";
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
        readonly RuntimeCompensationRecord: {
            readonly capacity_released: boolean;
            readonly cleanup_attempt_ids: readonly string[];
            readonly compensation_id: string;
            /** Format: date-time */
            readonly completed_at: string | null;
            /** Format: date-time */
            readonly deadline_at: string;
            /** Format: date-time */
            readonly detected_at: string;
            readonly evidence_event_ids: readonly string[];
            readonly job_id: string;
            readonly last_error: string | null;
            readonly lease_id: string | null;
            readonly node_run_id: string;
            /** @enum {string} */
            readonly reason: "node_timeout" | "job_timeout" | "lease_expired" | "worker_lost" | "operator_requested";
            readonly redispatched_job_id: string | null;
            readonly retry_scheduled: boolean;
            readonly run_id: string;
            /** @constant */
            readonly schema_version: 1;
            /** @enum {string} */
            readonly status: "detected" | "cancelling" | "cleanup_pending" | "cleanup_failed" | "completed";
            /** Format: date-time */
            readonly updated_at: string;
            readonly worker_id: string | null;
        };
        readonly RuntimeGraphNode: {
            readonly agentId: string | null;
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
        readonly RuntimeRecoveryScanResponse: {
            readonly completed: number;
            readonly detected: number;
            readonly failed: number;
            readonly records: readonly components["schemas"]["RuntimeCompensationRecord"][];
            readonly recovery: components["schemas"]["RuntimeRecoveryView"];
        };
        readonly RuntimeRecoveryView: {
            readonly compensations: readonly components["schemas"]["RuntimeCompensationRecord"][];
            readonly execution_replays: readonly components["schemas"]["ExecutionReplayResult"][];
            /** Format: date-time */
            readonly generated_at: string;
            /** @enum {string} */
            readonly posture: "healthy" | "recovering" | "degraded";
            readonly run_id: string;
            readonly summary: {
                readonly active_replays: number;
                readonly cleanup_failures: number;
                readonly compensations: number;
                readonly execution_replays: number;
                readonly pending_compensations: number;
            };
        };
        readonly RuntimeWorkspaceChange: {
            readonly after_sha256: string | null;
            readonly after_size_bytes: number | null;
            readonly before_sha256: string | null;
            readonly before_size_bytes: number | null;
            readonly diff: components["schemas"]["RuntimeWorkspaceTextDiff"];
            /** @enum {string} */
            readonly kind: "added" | "modified" | "deleted";
            readonly mode: number | null;
            readonly relative_path: string;
        };
        readonly RuntimeWorkspaceChangeSet: {
            readonly blocked_reason: string | null;
            readonly change_set_id: string;
            readonly changes: readonly components["schemas"]["RuntimeWorkspaceChange"][];
            /** Format: date-time */
            readonly created_at: string;
            readonly job_id: string;
            readonly node_run_id: string;
            /** @enum {string} */
            readonly origin?: "runtime" | "conversation";
            readonly resolution_comment: string | null;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly resolved_by: string | null;
            readonly run_id: string;
            readonly sandbox_root: string;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id?: string | null;
            readonly source_root: string;
            /** @enum {string} */
            readonly status: "pending" | "applied" | "rejected" | "blocked" | "apply_failed";
            readonly workspace_binding_id?: string | null;
        };
        readonly RuntimeWorkspaceDiffLine: {
            /** @enum {string} */
            readonly kind: "context" | "added" | "deleted" | "skip";
            readonly new_line: number | null;
            readonly old_line: number | null;
            readonly text: string;
        };
        readonly RuntimeWorkspaceTextDiff: {
            readonly lines: readonly components["schemas"]["RuntimeWorkspaceDiffLine"][];
            /** @enum {string} */
            readonly status: "available" | "binary" | "too_large";
            readonly truncated: boolean;
        };
        readonly RunValidationFailure: components["schemas"]["Error"] & {
            readonly validation: components["schemas"]["PlannerValidationResult"];
        };
        readonly ScheduleRecurrence: {
            /** @constant */
            readonly kind: "once";
            /** Format: date-time */
            readonly run_at: string;
        } | {
            readonly interval_minutes: number;
            /** @constant */
            readonly kind: "interval";
        } | {
            readonly expression: string;
            /** @constant */
            readonly kind: "cron";
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
        readonly SessionGeneratedArtifact: {
            readonly artifact_family_id: string | null;
            readonly artifact_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly has_previous_version: boolean;
            readonly mime_type: string | null;
            readonly name: string;
            readonly session_id: string;
            readonly size_bytes: number | null;
            readonly source_attachment_id: string | null;
            readonly storage_uri: string;
            readonly summary: string | null;
            readonly version: number;
        };
        readonly SessionGeneratedArtifactComparison: {
            readonly additions: number;
            readonly base: components["schemas"]["SessionGeneratedArtifact"];
            readonly changed: boolean;
            readonly deletions: number;
            readonly lines: readonly components["schemas"]["SessionGeneratedArtifactDiffLine"][];
            readonly target: components["schemas"]["SessionGeneratedArtifact"];
        };
        readonly SessionGeneratedArtifactDiffLine: {
            readonly new_line: number | null;
            readonly old_line: number | null;
            readonly text: string;
            /** @enum {string} */
            readonly type: "context" | "added" | "removed";
        };
        readonly SessionRecallContextMessage: {
            /** Format: date-time */
            readonly created_at: string;
            readonly kind: string;
            readonly matched: boolean;
            readonly message_id: string;
            /** @enum {string} */
            readonly role: "user" | "orchestrator" | "system";
            readonly text: string;
        };
        readonly SessionRecallHit: {
            readonly context: readonly components["schemas"]["SessionRecallContextMessage"][];
            /** Format: date-time */
            readonly matched_at: string;
            readonly matched_message_id: string;
            readonly score: number;
            readonly session_id: string;
            readonly session_title: string;
        };
        readonly SessionRecallRequest: {
            /** @default 2 */
            readonly context_radius?: number;
            readonly current_session_id: string;
            /** @default 5 */
            readonly limit?: number;
            readonly query: string;
        };
        readonly SessionRecallResult: {
            readonly count: number;
            readonly current_session_id: string;
            readonly hits: readonly components["schemas"]["SessionRecallHit"][];
            readonly index_rebuilt: boolean;
            readonly query: string;
            readonly workspace_id: string;
        };
        /** @enum {string} */
        readonly SessionStatus: "draft" | "planning" | "ready_to_run" | "running" | "waiting_human" | "completed" | "failed" | "cancelled";
        readonly SharedMemoryView: {
            readonly collection: components["schemas"]["MemoryCollection"];
            /** @enum {string} */
            readonly freshness: "current" | "stale" | "source_unavailable";
            readonly projected_memory: components["schemas"]["MemoryRecord"];
            readonly share: {
                readonly [key: string]: unknown;
            };
        };
        readonly Skill: {
            readonly allowed_tools: readonly string[];
            readonly category: string;
            readonly name: string;
            readonly skill_id: string;
            /** @enum {string} */
            readonly status: "active" | "disabled";
        };
        readonly SkillEvaluationRecord: {
            /** Format: date-time */
            readonly created_at: string;
            readonly error_code: string | null;
            readonly evaluation_id: string;
            readonly invocation_id: string | null;
            readonly latency_ms: number | null;
            readonly output_contract_passed: boolean;
            readonly skill_id: string;
            readonly skill_version: string;
            readonly tool_policy_passed: boolean;
            readonly tool_rounds: number;
            /** @enum {string} */
            readonly verdict: "passed" | "failed" | "partial";
            readonly workspace_id: string;
        };
        readonly SkillInvocationRecord: {
            readonly action_id: string | null;
            /** @enum {string} */
            readonly activation_source: "explicit" | "intent" | "model" | "preloaded";
            readonly allowed_tools: readonly string[];
            /** Format: date-time */
            readonly completed_at: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly error_code: string | null;
            readonly instructions_digest: string;
            readonly invocation_id: string;
            readonly output_contract: {
                readonly [key: string]: unknown;
            };
            readonly required_capabilities: readonly string[];
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly skill_id: string;
            readonly skill_version: string;
            /** @enum {string} */
            readonly status: "loaded" | "completed" | "failed";
            readonly tool_action_ids: readonly string[];
            /** Format: date-time */
            readonly updated_at: string;
            /** @enum {string} */
            readonly verification_status: "pending" | "passed" | "failed" | "not_applicable";
            readonly workspace_id: string;
        };
        readonly SkillPackageStatus: {
            readonly activation_keywords: readonly string[];
            /** @enum {string} */
            readonly activation_policy: "explicit_only" | "advisory" | "auto";
            readonly allowed_tools: readonly string[];
            readonly category: string;
            /** @enum {string} */
            readonly compatibility: "ready" | "degraded" | "blocked";
            readonly description: string;
            readonly enabled: boolean;
            readonly error: string | null;
            readonly input_schema: {
                readonly [key: string]: unknown;
            };
            readonly instructions_digest: string;
            readonly license: string | null;
            readonly manifest_path: string;
            readonly metadata: {
                readonly [key: string]: unknown;
            };
            readonly missing_requirements: readonly string[];
            readonly name: string;
            readonly negative_keywords: readonly string[];
            readonly output_contract: {
                readonly [key: string]: unknown;
            };
            readonly permission_scopes: readonly string[];
            readonly platforms: readonly string[];
            readonly publisher: string | null;
            readonly required_capabilities: readonly string[];
            readonly resources: readonly string[];
            /** @enum {string} */
            readonly risk_level: "T0" | "T1" | "T2" | "T3";
            readonly root_path: string;
            readonly scripts: readonly {
                readonly [key: string]: unknown;
            }[];
            readonly skill_id: string;
            /** @enum {string} */
            readonly source: "bundled" | "official_optional" | "installed" | "workspace" | "custom" | "marketplace";
            /** @enum {string} */
            readonly status: "ready" | "disabled" | "error" | "incompatible";
            /** @enum {string} */
            readonly trust_level: "bundled" | "official" | "workspace" | "community" | "unverified";
            readonly version: string;
            readonly workspace_id: string | null;
        };
        readonly SkillPermissionDelta: {
            readonly added_capabilities: readonly string[];
            readonly added_permission_scopes: readonly string[];
            readonly added_scripts: readonly string[];
            readonly added_tools: readonly string[];
            readonly from_version: string | null;
            readonly requires_review: boolean;
            readonly skill_id: string;
            readonly to_version: string;
        };
        readonly SkillWorkspaceProfile: {
            readonly auto_activation: boolean;
            /** Format: date-time */
            readonly created_at: string;
            readonly enabled_categories: readonly string[];
            readonly pinned_versions: {
                readonly [key: string]: string;
            };
            /** @constant */
            readonly schema_version: 1;
            readonly trusted_sources: readonly ("bundled" | "official" | "workspace" | "community" | "unverified")[];
            /** @enum {string} */
            readonly update_policy: "manual" | "notify" | "automatic_official";
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
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
        readonly SupervisionAlert: {
            readonly alert_id: string;
            /** @enum {string} */
            readonly category: "human_decision" | "runtime_failure" | "runtime_stalled" | "quality_gap" | "configuration" | "autopilot" | "memory_recommendation";
            readonly detail: string;
            readonly fingerprint: string;
            /** Format: date-time */
            readonly first_seen_at: string;
            /** Format: date-time */
            readonly last_seen_at: string;
            readonly metadata: Record<string, never>;
            readonly occurrence_count: number;
            readonly recommended_action: string;
            readonly recommended_action_label: string;
            /** Format: date-time */
            readonly resolved_at: string | null;
            readonly run_id: string | null;
            readonly session_id: string;
            /** @enum {string} */
            readonly severity: "info" | "warning" | "critical";
            /** @enum {string} */
            readonly status: "open" | "resolved";
            readonly title: string;
            readonly workspace_id: string;
        };
        readonly SupervisionScanResult: {
            readonly open_alerts: readonly components["schemas"]["SupervisionAlert"][];
            readonly resolved_alerts: readonly string[];
            readonly scanned_sessions: number;
        };
        readonly TaskCheckpoint: {
            readonly auto_resume_eligible: boolean;
            /** @enum {string} */
            readonly autonomy_mode: "review_first" | "assisted" | "autopilot";
            readonly checkpoint_id: string;
            /** Format: date-time */
            readonly completed_at: string | null;
            readonly context_summary: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly goal: string | null;
            readonly last_error_code: string | null;
            readonly last_error_message: string | null;
            readonly long_task_runtime: components["schemas"]["LongTaskRuntimeState"];
            readonly max_resume_attempts: number;
            readonly next_action: string | null;
            readonly progress_summary: string | null;
            readonly provider_state: components["schemas"]["TaskCheckpointProviderState"] | null;
            readonly reason: components["schemas"]["TaskCheckpointReason"];
            readonly resume_attempts: number;
            readonly resume_from_checkpoint_id: string | null;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly source_assistant_message_id: string | null;
            readonly source_user_message_id: string;
            readonly status: components["schemas"]["TaskCheckpointStatus"];
            readonly transitions: readonly components["schemas"]["TaskCheckpointTransition"][];
            /** Format: date-time */
            readonly updated_at: string;
            readonly version: number;
            readonly workspace_id: string;
        };
        readonly TaskCheckpointListResponse: {
            readonly items: readonly components["schemas"]["TaskCheckpoint"][];
        };
        readonly TaskCheckpointProviderState: {
            readonly action_ids: readonly string[];
            readonly compaction_count: number;
            readonly completion_contract: {
                readonly failed_action_ids: readonly string[];
                readonly reason: string;
                /** @enum {string} */
                readonly status: "satisfied" | "incomplete" | "blocked";
                readonly successful_action_ids: readonly string[];
            };
            readonly context_compacted: boolean;
            readonly context_pressure_peak_tokens: number;
            readonly context_snapshot_id: string | null;
            readonly continuation_limit_reached: boolean;
            readonly continuation_rounds: number;
            /** @enum {string|null} */
            readonly finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "unknown" | null;
            readonly in_loop_compaction_count: number;
            readonly pruned_tool_result_count: number;
            readonly repeated_tool_call_limit_reached: boolean;
            readonly tool_round_limit_reached: boolean;
            readonly tool_rounds: number;
        };
        /** @enum {string} */
        readonly TaskCheckpointReason: "turn_started" | "manual_resume" | "automatic_resume" | "context_compacted" | "continuation_limit" | "tool_round_limit" | "completion_contract_incomplete" | "budget_limit" | "provider_interrupted" | "client_disconnected" | "server_restart" | "waiting_approval" | "waiting_input" | "turn_completed" | "resume_limit" | "new_user_turn" | "unrecoverable_error";
        /** @enum {string} */
        readonly TaskCheckpointStatus: "in_progress" | "resumable" | "waiting_human" | "completed" | "failed" | "superseded";
        readonly TaskCheckpointTransition: {
            /** Format: date-time */
            readonly created_at: string;
            readonly detail: string | null;
            readonly reason: components["schemas"]["TaskCheckpointReason"];
            readonly status: components["schemas"]["TaskCheckpointStatus"];
            readonly version: number;
        };
        readonly TaskWorkspace: {
            /** Format: date-time */
            readonly archived_at: string | null;
            readonly binding_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly output_relative_path: string;
            readonly project: components["schemas"]["LocalProject"];
            readonly session_id: string;
            /** @enum {string} */
            readonly status: "active" | "archived";
            readonly task_workspace_id: string;
            /** Format: date-time */
            readonly updated_at: string;
        };
        readonly TaskWorkspaceResponse: {
            readonly task_workspace: components["schemas"]["TaskWorkspace"] | null;
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
        readonly TurnMemoryContextEntry: {
            readonly content: string;
            readonly content_digest: string;
            readonly kind: components["schemas"]["MemoryKind"];
            readonly memory_id: string;
            readonly memory_version: number;
            readonly scope_id: string;
            readonly scope_kind: components["schemas"]["MemoryScopeKind"];
            /** @enum {string} */
            readonly sensitivity: "normal" | "private";
            /** @enum {string} */
            readonly source?: "core_snapshot" | "automatic_recall" | "manual_overlay";
        };
        readonly TurnMemoryContextSnapshot: {
            readonly character_count: number;
            readonly context_id: string;
            /** Format: date-time */
            readonly created_at: string;
            readonly entries: readonly components["schemas"]["TurnMemoryContextEntry"][];
            readonly model: string | null;
            readonly prompt_digest: string;
            readonly provider_connection_id: string | null;
            /** @constant */
            readonly schema_version: 1;
            readonly session_id: string;
            readonly source_user_message_id: string;
            readonly workspace_id: string;
        };
        readonly UpdateAutopilotRequest: {
            readonly max_iterations?: number;
            readonly max_runtime_minutes?: number;
            /** @enum {string} */
            readonly mode: "review_first" | "assisted" | "autopilot";
        };
        readonly UpdateDagProposalAssignmentsRequest: {
            readonly assignments: readonly components["schemas"]["DagProposalAssignment"][];
        };
        readonly UpdateGovernancePolicyRequest: {
            readonly allow_self_approval?: boolean;
            readonly mode?: components["schemas"]["GovernanceMode"];
            readonly protected_actions?: readonly components["schemas"]["GovernanceProtectedAction"][];
            readonly required_approvals?: number;
        };
        readonly UpdateMemoryRequest: components["schemas"]["MemoryWriteFields"];
        readonly UpdateWorkspaceMemberRequest: {
            readonly display_name?: string;
            /** @enum {string} */
            readonly principal_type?: "user" | "service" | "development";
            readonly role: components["schemas"]["WorkspaceRole"];
            /** @enum {string} */
            readonly status?: "active" | "revoked";
        };
        readonly UpsertMcpServerRequest: {
            readonly args?: readonly string[];
            readonly command?: string | null;
            readonly connect_timeout_ms?: number;
            /** @enum {string|null} */
            readonly default_risk_level?: "T0" | "T1" | "T2" | "T3" | null;
            readonly description?: string | null;
            readonly enabled?: boolean;
            readonly environment?: {
                readonly [key: string]: string;
            };
            readonly headers?: {
                readonly [key: string]: string;
            };
            readonly name: string;
            readonly secrets?: {
                readonly [key: string]: string;
            };
            readonly server_id?: string;
            readonly tool_filter?: {
                readonly exclude?: readonly string[];
                readonly include?: readonly string[];
            };
            readonly tool_risk_overrides?: {
                readonly [key: string]: "T0" | "T1" | "T2" | "T3";
            };
            readonly tool_timeout_ms?: number;
            /** @enum {string} */
            readonly transport: "stdio" | "streamable-http";
            readonly url?: string | null;
        };
        readonly UpsertProviderConnectionRequest: {
            /** @enum {string} */
            readonly agent_runtime: "codex" | "claude-sdk" | "glm" | "kimi";
            readonly api_key?: string;
            readonly base_url?: string | null;
            readonly connection_id?: string;
            /** @default true */
            readonly context_compression_enabled?: boolean;
            /** @default 75 */
            readonly context_compression_threshold_percent?: number;
            readonly credential_env?: string;
            /** @enum {string} */
            readonly credential_source?: "managed" | "environment";
            readonly default_model?: string | null;
            /** @default 8 */
            readonly max_continuation_rounds?: number;
            /** @default 524288 */
            readonly max_input_tokens?: number;
            /** @default 65536 */
            readonly max_output_tokens?: number;
            /** @default 32 */
            readonly max_tool_rounds?: number;
            readonly metadata?: Record<string, never>;
            readonly models?: readonly string[];
            readonly name: string;
            /** @enum {string} */
            readonly protocol?: "codex-appserver" | "anthropic-messages" | "openai-compatible";
            readonly provider?: string;
            /** @enum {string} */
            readonly status?: "active" | "disabled";
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
        readonly UserSchedule: {
            readonly autonomy_mode: components["schemas"]["AutonomyMode"];
            /** Format: date-time */
            readonly created_at: string;
            readonly created_by: string;
            readonly enabled: boolean;
            /** Format: date-time */
            readonly last_run_at: string | null;
            /** @enum {string|null} */
            readonly last_run_status: "running" | "completed" | "waiting_human" | "failed" | null;
            readonly model: string | null;
            readonly name: string;
            /** Format: date-time */
            readonly next_run_at: string | null;
            readonly prompt: string;
            readonly provider_connection_id: string | null;
            readonly recurrence: components["schemas"]["ScheduleRecurrence"];
            readonly schedule_id: string;
            readonly session_id: string | null;
            /** @enum {string} */
            readonly task_mode: "new_task" | "resume_task";
            readonly task_title: string | null;
            readonly timezone: string;
            /** Format: date-time */
            readonly updated_at: string;
            readonly workspace_id: string;
        };
        readonly UserScheduleRequest: {
            /** @enum {string} */
            readonly autonomy_mode?: "review_first" | "assisted" | "autopilot";
            readonly enabled?: boolean;
            readonly model?: string | null;
            readonly name: string;
            readonly prompt: string;
            readonly provider_connection_id?: string | null;
            readonly recurrence: components["schemas"]["ScheduleRecurrence"];
            readonly session_id?: string | null;
            /** @enum {string} */
            readonly task_mode?: "new_task" | "resume_task";
            readonly task_title?: string | null;
            readonly timezone: string;
        };
        readonly UserScheduleRun: {
            readonly assistant_message_id: string | null;
            readonly error_code: string | null;
            readonly error_message: string | null;
            /** Format: date-time */
            readonly finished_at: string | null;
            readonly run_id: string;
            readonly schedule_id: string;
            /** Format: date-time */
            readonly scheduled_for: string;
            readonly session_id: string | null;
            /** Format: date-time */
            readonly started_at: string;
            /** @enum {string} */
            readonly status: "running" | "completed" | "waiting_human" | "failed";
            readonly workspace_id: string;
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
        readonly WorkspaceBindingResponse: {
            readonly binding: components["schemas"]["PublicWorkspaceBinding"] | null;
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
        readonly WorkspacePermission: "workspace.read" | "workspace.manage_members" | "registry.manage" | "governance.review" | "mission.create" | "mission.edit" | "run.create" | "run.control" | "run.evaluate" | "gate.resolve" | "memory.read" | "memory.propose" | "memory.write" | "memory.review" | "memory.manage" | "audit.read";
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
export type SchemaAgentBindingSnapshot = components['schemas']['AgentBindingSnapshot'];
export type SchemaAgentDag = components['schemas']['AgentDag'];
export type SchemaAgentDagGate = components['schemas']['AgentDagGate'];
export type SchemaAgentDagStatus = components['schemas']['AgentDagStatus'];
export type SchemaAgentDefinition = components['schemas']['AgentDefinition'];
export type SchemaAgentMessage = components['schemas']['AgentMessage'];
export type SchemaAgentRole = components['schemas']['AgentRole'];
export type SchemaAgentRun = components['schemas']['AgentRun'];
export type SchemaAgentRunEvent = components['schemas']['AgentRunEvent'];
export type SchemaAgentRunStatus = components['schemas']['AgentRunStatus'];
export type SchemaAgentTask = components['schemas']['AgentTask'];
export type SchemaAgentTaskStatus = components['schemas']['AgentTaskStatus'];
export type SchemaAgentTeam = components['schemas']['AgentTeam'];
export type SchemaAgentVersion = components['schemas']['AgentVersion'];
export type SchemaApprovalRecord = components['schemas']['ApprovalRecord'];
export type SchemaArtifact = components['schemas']['Artifact'];
export type SchemaAuthenticatedPrincipal = components['schemas']['AuthenticatedPrincipal'];
export type SchemaAuthMeResponse = components['schemas']['AuthMeResponse'];
export type SchemaAutonomyMode = components['schemas']['AutonomyMode'];
export type SchemaAutopilotController = components['schemas']['AutopilotController'];
export type SchemaCommentRequest = components['schemas']['CommentRequest'];
export type SchemaConfirmDagProposalRequest = components['schemas']['ConfirmDagProposalRequest'];
export type SchemaConfirmDagProposalResponse = components['schemas']['ConfirmDagProposalResponse'];
export type SchemaConversationIntentEvaluationResult = components['schemas']['ConversationIntentEvaluationResult'];
export type SchemaCoreMemorySnapshot = components['schemas']['CoreMemorySnapshot'];
export type SchemaCoreMemorySnapshotEntry = components['schemas']['CoreMemorySnapshotEntry'];
export type SchemaCreateDagProposalRequest = components['schemas']['CreateDagProposalRequest'];
export type SchemaCreateDagProposalResponse = components['schemas']['CreateDagProposalResponse'];
export type SchemaCreateEvaluationRequest = components['schemas']['CreateEvaluationRequest'];
export type SchemaCreateGovernanceChangeRequest = components['schemas']['CreateGovernanceChangeRequest'];
export type SchemaCreateMemoryCandidateRequest = components['schemas']['CreateMemoryCandidateRequest'];
export type SchemaCreateMemoryRequest = components['schemas']['CreateMemoryRequest'];
export type SchemaCreateReplayPlanRequest = components['schemas']['CreateReplayPlanRequest'];
export type SchemaCreateRerunRequest = components['schemas']['CreateRerunRequest'];
export type SchemaCreateRerunResponse = components['schemas']['CreateRerunResponse'];
export type SchemaCreateRunRequest = components['schemas']['CreateRunRequest'];
export type SchemaCreateRunResponse = components['schemas']['CreateRunResponse'];
export type SchemaCreateScorecardRequest = components['schemas']['CreateScorecardRequest'];
export type SchemaCreateTemplateRequest = components['schemas']['CreateTemplateRequest'];
export type SchemaCreateWorkspaceRequest = components['schemas']['CreateWorkspaceRequest'];
export type SchemaDagDefinition = components['schemas']['DagDefinition'];
export type SchemaDagDefinitionAgentSelector = components['schemas']['DagDefinitionAgentSelector'];
export type SchemaDagDefinitionNode = components['schemas']['DagDefinitionNode'];
export type SchemaDagProposalAssignment = components['schemas']['DagProposalAssignment'];
export type SchemaDagProposalPlannerContext = components['schemas']['DagProposalPlannerContext'];
export type SchemaDagProposalRecord = components['schemas']['DagProposalRecord'];
export type SchemaDagProposalResponse = components['schemas']['DagProposalResponse'];
export type SchemaDagProposalStatus = components['schemas']['DagProposalStatus'];
export type SchemaDagProposalSummary = components['schemas']['DagProposalSummary'];
export type SchemaDashboardComparisonMetric = components['schemas']['DashboardComparisonMetric'];
export type SchemaDashboardCostAttributionGroup = components['schemas']['DashboardCostAttributionGroup'];
export type SchemaDashboardCostReport = components['schemas']['DashboardCostReport'];
export type SchemaDashboardMoneyTotals = components['schemas']['DashboardMoneyTotals'];
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
export type SchemaExecutionReplayResult = components['schemas']['ExecutionReplayResult'];
export type SchemaGovernanceApprovalRecord = components['schemas']['GovernanceApprovalRecord'];
export type SchemaGovernanceChangeListResponse = components['schemas']['GovernanceChangeListResponse'];
export type SchemaGovernanceChangeRecord = components['schemas']['GovernanceChangeRecord'];
export type SchemaGovernanceChangeStatus = components['schemas']['GovernanceChangeStatus'];
export type SchemaGovernanceDecisionRequest = components['schemas']['GovernanceDecisionRequest'];
export type SchemaGovernanceMode = components['schemas']['GovernanceMode'];
export type SchemaGovernancePolicyRecord = components['schemas']['GovernancePolicyRecord'];
export type SchemaGovernanceProtectedAction = components['schemas']['GovernanceProtectedAction'];
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
export type SchemaLocalProject = components['schemas']['LocalProject'];
export type SchemaLocalProjectListResponse = components['schemas']['LocalProjectListResponse'];
export type SchemaLongTaskRuntimeState = components['schemas']['LongTaskRuntimeState'];
export type SchemaMcpConnectorPreset = components['schemas']['McpConnectorPreset'];
export type SchemaMcpConnectorPresetSecret = components['schemas']['McpConnectorPresetSecret'];
export type SchemaMcpDiscoveredTool = components['schemas']['McpDiscoveredTool'];
export type SchemaMcpServer = components['schemas']['McpServer'];
export type SchemaMemoryBackupMetadata = components['schemas']['MemoryBackupMetadata'];
export type SchemaMemoryCandidateOperation = components['schemas']['MemoryCandidateOperation'];
export type SchemaMemoryCandidateRecord = components['schemas']['MemoryCandidateRecord'];
export type SchemaMemoryCandidateRisk = components['schemas']['MemoryCandidateRisk'];
export type SchemaMemoryCandidateStatus = components['schemas']['MemoryCandidateStatus'];
export type SchemaMemoryCollection = components['schemas']['MemoryCollection'];
export type SchemaMemoryConflictRecord = components['schemas']['MemoryConflictRecord'];
export type SchemaMemoryEffectiveness = components['schemas']['MemoryEffectiveness'];
export type SchemaMemoryEmbeddingProviderStatus = components['schemas']['MemoryEmbeddingProviderStatus'];
export type SchemaMemoryExternalSource = components['schemas']['MemoryExternalSource'];
export type SchemaMemoryImportRequest = components['schemas']['MemoryImportRequest'];
export type SchemaMemoryImportResult = components['schemas']['MemoryImportResult'];
export type SchemaMemoryIntegrityReport = components['schemas']['MemoryIntegrityReport'];
export type SchemaMemoryKeyStatus = components['schemas']['MemoryKeyStatus'];
export type SchemaMemoryKind = components['schemas']['MemoryKind'];
export type SchemaMemoryKnowledgeProviderStatus = components['schemas']['MemoryKnowledgeProviderStatus'];
export type SchemaMemoryKnowledgeQueryRequest = components['schemas']['MemoryKnowledgeQueryRequest'];
export type SchemaMemoryKnowledgeQueryResult = components['schemas']['MemoryKnowledgeQueryResult'];
export type SchemaMemoryKnowledgeRelation = components['schemas']['MemoryKnowledgeRelation'];
export type SchemaMemoryMaintenanceResult = components['schemas']['MemoryMaintenanceResult'];
export type SchemaMemoryMaintenanceSweepResult = components['schemas']['MemoryMaintenanceSweepResult'];
export type SchemaMemoryObservability = components['schemas']['MemoryObservability'];
export type SchemaMemoryOnboarding = components['schemas']['MemoryOnboarding'];
export type SchemaMemoryOperationsStatus = components['schemas']['MemoryOperationsStatus'];
export type SchemaMemoryOverlay = components['schemas']['MemoryOverlay'];
export type SchemaMemoryProposal = components['schemas']['MemoryProposal'];
export type SchemaMemoryPurgeResult = components['schemas']['MemoryPurgeResult'];
export type SchemaMemoryRecommendation = components['schemas']['MemoryRecommendation'];
export type SchemaMemoryRecommendationFeedback = components['schemas']['MemoryRecommendationFeedback'];
export type SchemaMemoryRecommendationResult = components['schemas']['MemoryRecommendationResult'];
export type SchemaMemoryRecord = components['schemas']['MemoryRecord'];
export type SchemaMemoryRestoreResult = components['schemas']['MemoryRestoreResult'];
export type SchemaMemoryRetentionRunResult = components['schemas']['MemoryRetentionRunResult'];
export type SchemaMemoryRetrievalEvidence = components['schemas']['MemoryRetrievalEvidence'];
export type SchemaMemoryRetrievalHit = components['schemas']['MemoryRetrievalHit'];
export type SchemaMemoryRetrievalIndexStatus = components['schemas']['MemoryRetrievalIndexStatus'];
export type SchemaMemoryRetrievalMode = components['schemas']['MemoryRetrievalMode'];
export type SchemaMemoryRetrievalRequest = components['schemas']['MemoryRetrievalRequest'];
export type SchemaMemoryRetrievalResult = components['schemas']['MemoryRetrievalResult'];
export type SchemaMemoryReviewRecord = components['schemas']['MemoryReviewRecord'];
export type SchemaMemoryScopeKind = components['schemas']['MemoryScopeKind'];
export type SchemaMemorySensitivity = components['schemas']['MemorySensitivity'];
export type SchemaMemorySettings = components['schemas']['MemorySettings'];
export type SchemaMemoryShareGrant = components['schemas']['MemoryShareGrant'];
export type SchemaMemorySource = components['schemas']['MemorySource'];
export type SchemaMemorySourceOrigin = components['schemas']['MemorySourceOrigin'];
export type SchemaMemoryStatus = components['schemas']['MemoryStatus'];
export type SchemaMemorySyncRun = components['schemas']['MemorySyncRun'];
export type SchemaMemoryWriteFields = components['schemas']['MemoryWriteFields'];
export type SchemaMissionMaterializerConsistencyReport = components['schemas']['MissionMaterializerConsistencyReport'];
export type SchemaMissionMaterializerRebuildResponse = components['schemas']['MissionMaterializerRebuildResponse'];
export type SchemaMissionMaterializerStatus = components['schemas']['MissionMaterializerStatus'];
export type SchemaMissionUiBlock = components['schemas']['MissionUiBlock'];
export type SchemaMissionUiPlan = components['schemas']['MissionUiPlan'];
export type SchemaMobileHomeResponse = components['schemas']['MobileHomeResponse'];
export type SchemaMobileInboxItem = components['schemas']['MobileInboxItem'];
export type SchemaMobileRunDetail = components['schemas']['MobileRunDetail'];
export type SchemaMobileRunFollowUp = components['schemas']['MobileRunFollowUp'];
export type SchemaMobileRunSummary = components['schemas']['MobileRunSummary'];
export type SchemaMobileTask = components['schemas']['MobileTask'];
export type SchemaNodeHandoffRecord = components['schemas']['NodeHandoffRecord'];
export type SchemaNodeStatus = components['schemas']['NodeStatus'];
export type SchemaNotification = components['schemas']['Notification'];
export type SchemaOrchestrationDecision = components['schemas']['OrchestrationDecision'];
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
export type SchemaProviderConnection = components['schemas']['ProviderConnection'];
export type SchemaPublicWorkspaceBinding = components['schemas']['PublicWorkspaceBinding'];
export type SchemaPublishTemplateResponse = components['schemas']['PublishTemplateResponse'];
export type SchemaRegistryProvenance = components['schemas']['RegistryProvenance'];
export type SchemaRejectDagProposalRequest = components['schemas']['RejectDagProposalRequest'];
export type SchemaReplayDifference = components['schemas']['ReplayDifference'];
export type SchemaReplayPlanRecommendation = components['schemas']['ReplayPlanRecommendation'];
export type SchemaReplayPlanResult = components['schemas']['ReplayPlanResult'];
export type SchemaReplayResult = components['schemas']['ReplayResult'];
export type SchemaResolveMemoryCandidateRequest = components['schemas']['ResolveMemoryCandidateRequest'];
export type SchemaResumeTaskCheckpointRequest = components['schemas']['ResumeTaskCheckpointRequest'];
export type SchemaResumeTaskCheckpointResponse = components['schemas']['ResumeTaskCheckpointResponse'];
export type SchemaRunDetail = components['schemas']['RunDetail'];
export type SchemaRunRoute = components['schemas']['RunRoute'];
export type SchemaRunStatus = components['schemas']['RunStatus'];
export type SchemaRunSummary = components['schemas']['RunSummary'];
export type SchemaRuntimeCompensationRecord = components['schemas']['RuntimeCompensationRecord'];
export type SchemaRuntimeGraphNode = components['schemas']['RuntimeGraphNode'];
export type SchemaRuntimeRecoveryScanResponse = components['schemas']['RuntimeRecoveryScanResponse'];
export type SchemaRuntimeRecoveryView = components['schemas']['RuntimeRecoveryView'];
export type SchemaRuntimeWorkspaceChange = components['schemas']['RuntimeWorkspaceChange'];
export type SchemaRuntimeWorkspaceChangeSet = components['schemas']['RuntimeWorkspaceChangeSet'];
export type SchemaRuntimeWorkspaceDiffLine = components['schemas']['RuntimeWorkspaceDiffLine'];
export type SchemaRuntimeWorkspaceTextDiff = components['schemas']['RuntimeWorkspaceTextDiff'];
export type SchemaRunValidationFailure = components['schemas']['RunValidationFailure'];
export type SchemaScheduleRecurrence = components['schemas']['ScheduleRecurrence'];
export type SchemaScorecardFinding = components['schemas']['ScorecardFinding'];
export type SchemaScorecardResult = components['schemas']['ScorecardResult'];
export type SchemaSecurityAuditEvent = components['schemas']['SecurityAuditEvent'];
export type SchemaSessionGeneratedArtifact = components['schemas']['SessionGeneratedArtifact'];
export type SchemaSessionGeneratedArtifactComparison = components['schemas']['SessionGeneratedArtifactComparison'];
export type SchemaSessionGeneratedArtifactDiffLine = components['schemas']['SessionGeneratedArtifactDiffLine'];
export type SchemaSessionRecallContextMessage = components['schemas']['SessionRecallContextMessage'];
export type SchemaSessionRecallHit = components['schemas']['SessionRecallHit'];
export type SchemaSessionRecallRequest = components['schemas']['SessionRecallRequest'];
export type SchemaSessionRecallResult = components['schemas']['SessionRecallResult'];
export type SchemaSessionStatus = components['schemas']['SessionStatus'];
export type SchemaSharedMemoryView = components['schemas']['SharedMemoryView'];
export type SchemaSkill = components['schemas']['Skill'];
export type SchemaSkillEvaluationRecord = components['schemas']['SkillEvaluationRecord'];
export type SchemaSkillInvocationRecord = components['schemas']['SkillInvocationRecord'];
export type SchemaSkillPackageStatus = components['schemas']['SkillPackageStatus'];
export type SchemaSkillPermissionDelta = components['schemas']['SkillPermissionDelta'];
export type SchemaSkillWorkspaceProfile = components['schemas']['SkillWorkspaceProfile'];
export type SchemaSupersedeDagProposalRequest = components['schemas']['SupersedeDagProposalRequest'];
export type SchemaSupersedeDagProposalResponse = components['schemas']['SupersedeDagProposalResponse'];
export type SchemaSuperviseEvidenceDelta = components['schemas']['SuperviseEvidenceDelta'];
export type SchemaSuperviseRunResponse = components['schemas']['SuperviseRunResponse'];
export type SchemaSupervisionAlert = components['schemas']['SupervisionAlert'];
export type SchemaSupervisionScanResult = components['schemas']['SupervisionScanResult'];
export type SchemaTaskCheckpoint = components['schemas']['TaskCheckpoint'];
export type SchemaTaskCheckpointListResponse = components['schemas']['TaskCheckpointListResponse'];
export type SchemaTaskCheckpointProviderState = components['schemas']['TaskCheckpointProviderState'];
export type SchemaTaskCheckpointReason = components['schemas']['TaskCheckpointReason'];
export type SchemaTaskCheckpointStatus = components['schemas']['TaskCheckpointStatus'];
export type SchemaTaskCheckpointTransition = components['schemas']['TaskCheckpointTransition'];
export type SchemaTaskWorkspace = components['schemas']['TaskWorkspace'];
export type SchemaTaskWorkspaceResponse = components['schemas']['TaskWorkspaceResponse'];
export type SchemaTemplateLineageResponse = components['schemas']['TemplateLineageResponse'];
export type SchemaTemplateSummary = components['schemas']['TemplateSummary'];
export type SchemaTraceProjection = components['schemas']['TraceProjection'];
export type SchemaTraceSpan = components['schemas']['TraceSpan'];
export type SchemaTurnMemoryContextEntry = components['schemas']['TurnMemoryContextEntry'];
export type SchemaTurnMemoryContextSnapshot = components['schemas']['TurnMemoryContextSnapshot'];
export type SchemaUpdateAutopilotRequest = components['schemas']['UpdateAutopilotRequest'];
export type SchemaUpdateDagProposalAssignmentsRequest = components['schemas']['UpdateDagProposalAssignmentsRequest'];
export type SchemaUpdateGovernancePolicyRequest = components['schemas']['UpdateGovernancePolicyRequest'];
export type SchemaUpdateMemoryRequest = components['schemas']['UpdateMemoryRequest'];
export type SchemaUpdateWorkspaceMemberRequest = components['schemas']['UpdateWorkspaceMemberRequest'];
export type SchemaUpsertMcpServerRequest = components['schemas']['UpsertMcpServerRequest'];
export type SchemaUpsertProviderConnectionRequest = components['schemas']['UpsertProviderConnectionRequest'];
export type SchemaUsageSummary = components['schemas']['UsageSummary'];
export type SchemaUserSchedule = components['schemas']['UserSchedule'];
export type SchemaUserScheduleRequest = components['schemas']['UserScheduleRequest'];
export type SchemaUserScheduleRun = components['schemas']['UserScheduleRun'];
export type SchemaWorkerEvidenceSource = components['schemas']['WorkerEvidenceSource'];
export type SchemaWorkerEvidenceTrace = components['schemas']['WorkerEvidenceTrace'];
export type SchemaWorkspaceBindingResponse = components['schemas']['WorkspaceBindingResponse'];
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
    readonly listGovernanceChanges: {
        readonly parameters: {
            readonly query?: {
                readonly action?: components["schemas"]["GovernanceProtectedAction"];
                readonly limit?: number;
                readonly status?: components["schemas"]["GovernanceChangeStatus"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Governance change list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeListResponse"];
                };
            };
        };
    };
    readonly createGovernanceChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateGovernanceChangeRequest"];
            };
        };
        readonly responses: {
            /** @description Pending governance change */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"];
                };
            };
            /** @description Invalid proposal */
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
    readonly getGovernanceChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly changeId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Governance change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"];
                };
            };
            /** @description Change not found in the selected workspace */
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
    readonly applyGovernanceChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly changeId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Applied governance change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"];
                };
            };
            /** @description Change is not approved or the resource baseline drifted */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"] | components["schemas"]["Error"];
                };
            };
        };
    };
    readonly approveGovernanceChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly changeId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["GovernanceDecisionRequest"];
            };
        };
        readonly responses: {
            /** @description Updated governance change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"];
                };
            };
            /** @description Self approval, duplicate decision, or invalid state */
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
    readonly rejectGovernanceChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly changeId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["GovernanceDecisionRequest"];
            };
        };
        readonly responses: {
            /** @description Rejected governance change */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernanceChangeRecord"];
                };
            };
            /** @description Self decision, duplicate decision, or invalid state */
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
    readonly getGovernancePolicy: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Governance policy */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernancePolicyRecord"];
                };
            };
        };
    };
    readonly updateGovernancePolicy: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UpdateGovernancePolicyRequest"];
            };
        };
        readonly responses: {
            /** @description Updated policy */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["GovernancePolicyRecord"];
                };
            };
            /** @description Invalid policy */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Governance review permission required */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly listMemories: {
        readonly parameters: {
            readonly query?: {
                readonly kind?: components["schemas"]["MemoryKind"];
                readonly limit?: number;
                readonly query?: string;
                readonly scope_id?: string;
                readonly scope_kind?: components["schemas"]["MemoryScopeKind"];
                readonly status?: "active" | "superseded" | "expired" | "deleted" | "all";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Workspace memory list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryRecord"][];
                    };
                };
            };
        };
    };
    readonly createMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateMemoryRequest"];
            };
        };
        readonly responses: {
            /** @description Memory created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecord"];
                };
            };
            /** @description Secret or credential content was rejected */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory record */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecord"];
                };
            };
            /** @description Memory not found in this Workspace */
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
    readonly deleteMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Deleted memory record */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecord"];
                };
            };
        };
    };
    readonly updateMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UpdateMemoryRequest"];
            };
        };
        readonly responses: {
            /** @description Updated memory */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecord"];
                };
            };
            /** @description Deleted memory cannot be updated */
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
    readonly hardPurgeMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly confirm_memory_id: string;
                };
            };
        };
        readonly responses: {
            /** @description Purge and cryptographic erasure result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryPurgeResult"];
                };
            };
        };
    };
    readonly restoreMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly memoryId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Restored memory */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecord"];
                };
            };
        };
    };
    readonly exportMemories: {
        readonly parameters: {
            readonly query?: {
                readonly format?: "json" | "jsonl";
                readonly status?: "active" | "superseded" | "expired" | "deleted" | "all";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Portable memory export */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                    readonly "application/x-ndjson": string;
                };
            };
        };
    };
    readonly importMemories: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MemoryImportRequest"];
            };
        };
        readonly responses: {
            /** @description Import result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryImportResult"];
                };
            };
        };
    };
    readonly listMemoryBackups: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Backup metadata */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryBackupMetadata"][];
                    };
                };
            };
        };
    };
    readonly createEncryptedMemoryBackup: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly passphrase: string;
                };
            };
        };
        readonly responses: {
            /** @description Backup metadata */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryBackupMetadata"];
                };
            };
        };
    };
    readonly restoreEncryptedMemoryBackup: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly backupId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @default false */
                    readonly dry_run?: boolean;
                    readonly passphrase: string;
                };
            };
        };
        readonly responses: {
            /** @description Restore result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRestoreResult"];
                };
            };
        };
    };
    readonly listMemoryCandidates: {
        readonly parameters: {
            readonly query?: {
                readonly status?: "pending" | "approved" | "rejected" | "all";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory candidate list */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryCandidateRecord"][];
                    };
                };
            };
        };
    };
    readonly createMemoryCandidate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateMemoryCandidateRequest"];
            };
        };
        readonly responses: {
            /** @description Memory candidate created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryCandidateRecord"];
                };
            };
        };
    };
    readonly getMemoryCandidate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly candidateId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory candidate */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryCandidateRecord"];
                };
            };
        };
    };
    readonly approveMemoryCandidate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly candidateId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["ResolveMemoryCandidateRequest"];
            };
        };
        readonly responses: {
            /** @description Candidate approved and memory committed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly candidate: components["schemas"]["MemoryCandidateRecord"];
                        readonly memory: components["schemas"]["MemoryRecord"];
                    };
                };
            };
            /** @description Candidate was already resolved */
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
    readonly rejectMemoryCandidate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly candidateId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["ResolveMemoryCandidateRequest"];
            };
        };
        readonly responses: {
            /** @description Candidate rejected */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryCandidateRecord"];
                };
            };
            /** @description Candidate was already resolved */
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
    readonly listMemoryCollections: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Team and Organization Memory collections */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryCollection"][];
                    };
                };
            };
        };
    };
    readonly createMemoryCollection: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @enum {string} */
                    readonly kind: "team" | "organization";
                    readonly member_workspace_ids: readonly string[];
                    readonly name: string;
                };
            };
        };
        readonly responses: {
            /** @description Collection created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryCollection"];
                };
            };
        };
    };
    readonly updateMemoryCollection: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly collectionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Collection updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryCollection"];
                };
            };
        };
    };
    readonly listMemoryConflicts: {
        readonly parameters: {
            readonly query?: {
                readonly status?: "pending" | "resolved" | "dismissed" | "all";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory conflicts */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryConflictRecord"][];
                    };
                };
            };
        };
    };
    readonly resolveMemoryConflict: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly conflictId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Resolved conflict and canonical Memory */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
        };
    };
    readonly getMemoryEffectiveness: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory effectiveness metrics */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryEffectiveness"];
                };
            };
        };
    };
    readonly listMemoryExternalSources: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description External sources and sync runs */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryExternalSource"][];
                        readonly runs: readonly components["schemas"]["MemorySyncRun"][];
                    };
                };
            };
        };
    };
    readonly createMemoryExternalSource: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description External source created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryExternalSource"];
                };
            };
        };
    };
    readonly ingestExternalMemoryBatch: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly sourceId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Sync result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemorySyncRun"];
                };
            };
        };
    };
    readonly syncExternalMemorySource: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly sourceId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description MCP pull sync result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemorySyncRun"];
                };
            };
        };
    };
    readonly scanMemoryIntegrity: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Integrity report */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryIntegrityReport"];
                };
            };
        };
    };
    readonly evaluateMemoryIntelligence: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Intent routing quality metrics and fixture results */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ConversationIntentEvaluationResult"];
                };
            };
        };
    };
    readonly rotateMemoryEncryptionKey: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Rotation result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly key: components["schemas"]["MemoryKeyStatus"];
                        readonly retired_keys_destroyed: number;
                        readonly rewritten_records: number;
                    };
                };
            };
        };
    };
    readonly queryMemoryKnowledgeGraph: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MemoryKnowledgeQueryRequest"];
            };
        };
        readonly responses: {
            /** @description Provenance-filtered knowledge graph relations */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryKnowledgeQueryResult"];
                };
            };
        };
    };
    readonly rebuildMemoryKnowledgeGraph: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Optional provider rebuild summary */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly [key: string]: unknown;
                    };
                };
            };
        };
    };
    readonly getMemoryKnowledgeProviderStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Knowledge provider status */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryKnowledgeProviderStatus"];
                };
            };
        };
    };
    readonly getMemoryMaintenance: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Latest maintenance result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly last_run: components["schemas"]["MemoryMaintenanceResult"] | null;
                    };
                };
            };
        };
    };
    readonly runMemoryMaintenance: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Maintenance result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryMaintenanceResult"];
                };
            };
        };
    };
    readonly runMemoryMaintenanceSweep: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Multi-Workspace maintenance sweep result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryMaintenanceSweepResult"];
                };
            };
        };
    };
    readonly getMemoryObservability: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory observability */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryObservability"];
                };
            };
        };
    };
    readonly getMemoryOnboarding: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Resumable guided Memory onboarding state */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOnboarding"];
                };
            };
        };
    };
    readonly completeMemoryOnboarding: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Completed onboarding */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOnboarding"];
                };
            };
        };
    };
    readonly dismissMemoryOnboarding: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Dismissed onboarding without deleting drafts */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOnboarding"];
                };
            };
        };
    };
    readonly previewMemoryOnboarding: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Saved onboarding draft preview */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOnboarding"];
                };
            };
        };
    };
    readonly startMemoryOnboarding: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Started or resumed onboarding */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOnboarding"];
                };
            };
        };
    };
    readonly getMemoryOperationsStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory operations status */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOperationsStatus"];
                };
            };
        };
    };
    readonly runMemoryRetention: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Retention result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRetentionRunResult"];
                };
            };
        };
    };
    readonly rebuildMemoryRetrieval: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Rebuild result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly records: number;
                        readonly status: components["schemas"]["MemoryRetrievalIndexStatus"];
                    };
                };
            };
        };
    };
    readonly searchLongTermMemory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["MemoryRetrievalRequest"];
            };
        };
        readonly responses: {
            /** @description Hybrid memory results with retrieval evidence */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRetrievalResult"];
                };
            };
            /** @description Rebuildable memory retrieval index is unavailable */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getMemoryRetrievalStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory retrieval status */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRetrievalIndexStatus"];
                };
            };
        };
    };
    readonly getMemorySettings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Memory settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemorySettings"];
                };
            };
        };
    };
    readonly updateMemorySettings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Updated memory settings */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemorySettings"];
                };
            };
        };
    };
    readonly listMemoryShares: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Outgoing grants and incoming projections */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MemoryShareGrant"][];
                        readonly views: readonly components["schemas"]["SharedMemoryView"][];
                    };
                };
            };
        };
    };
    readonly createMemoryShare: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly [key: string]: unknown;
                };
            };
        };
        readonly responses: {
            /** @description Share created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryShareGrant"];
                };
            };
        };
    };
    readonly revokeMemoryShare: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly shareId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Share revoked */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryShareGrant"];
                };
            };
        };
    };
    readonly suggestSharedMemoryChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly shareId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly proposed_content: string;
                };
            };
        };
        readonly responses: {
            /** @description Conflict proposal created in source Workspace */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryConflictRecord"];
                };
            };
        };
    };
    readonly getMissionMaterializerStatus: {
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
            /** @description Mission materializer status */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MissionMaterializerStatus"];
                };
            };
            /** @description Mission not found */
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
    readonly rebuildMissionMaterializer: {
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
            /** @description Rebuilt Mission materializer */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MissionMaterializerRebuildResponse"];
                };
            };
            /** @description Mission not found */
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
    readonly verifyMissionMaterializer: {
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
            /** @description Mission materializer consistency report */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MissionMaterializerConsistencyReport"];
                };
            };
            /** @description Mission not found */
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
    readonly listLocalProjects: {
        readonly parameters: {
            readonly query?: {
                readonly visibility?: "active" | "all";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Local Projects registered by an authenticated Desktop Host */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LocalProjectListResponse"];
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
    readonly createNodeFailureReplay: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "Idempotency-Key": string;
            };
            readonly path: {
                readonly nodeRunId: string;
                readonly runId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Existing replay returned for the Idempotency-Key */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ExecutionReplayResult"];
                };
            };
            /** @description Failure replay persisted and dispatched */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ExecutionReplayResult"];
                };
            };
            /** @description Node is not failed or execution resources are unsettled */
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
    readonly getRunRecovery: {
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
            /** @description Recovery posture and audit records */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RuntimeRecoveryView"];
                };
            };
            /** @description Run not found or outside the selected workspace */
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
    readonly getNodeFailureReplay: {
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
            /** @description Failure replay record */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ExecutionReplayResult"];
                };
            };
            /** @description Failure replay not found */
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
    readonly scanRunRecovery: {
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
            /** @description Bounded recovery scan result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RuntimeRecoveryScanResponse"];
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
    readonly searchHistoricalSessions: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["SessionRecallRequest"];
            };
        };
        readonly responses: {
            /** @description Anchored historical Session matches */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionRecallResult"];
                };
            };
            /** @description The rebuildable Session Recall index is unavailable */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    readonly getSessionGeneratedArtifact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly artifactId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Generated artifact metadata, preview content, and version lineage */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly artifact: components["schemas"]["SessionGeneratedArtifact"];
                        readonly content: string;
                        /** @enum {string} */
                        readonly preview_kind: "markdown" | "text";
                        readonly previous_artifact_id: string | null;
                        readonly versions: readonly components["schemas"]["SessionGeneratedArtifact"][];
                    };
                };
            };
            /** @description Generated artifact or Session not found */
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
    readonly compareSessionGeneratedArtifact: {
        readonly parameters: {
            readonly query?: {
                readonly base_artifact_id?: string;
            };
            readonly header?: never;
            readonly path: {
                readonly artifactId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Line-level comparison between two versions of a generated artifact */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionGeneratedArtifactComparison"];
                };
            };
            /** @description Generated artifact, Session, or previous version not found */
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
    readonly downloadSessionGeneratedArtifact: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly artifactId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description UTF-8 content of a generated Session artifact */
            readonly 200: {
                headers: {
                    readonly "Content-Disposition"?: string;
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/markdown": string;
                    readonly "text/plain": string;
                };
            };
            /** @description Generated artifact or Session not found */
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
    readonly getSessionAutopilot: {
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
            /** @description Durable Session Autopilot controller */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AutopilotController"];
                };
            };
        };
    };
    readonly updateSessionAutopilot: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UpdateAutopilotRequest"];
            };
        };
        readonly responses: {
            /** @description Updated Session Autopilot controller */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AutopilotController"];
                };
            };
        };
    };
    readonly pauseSessionAutopilot: {
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
            /** @description Paused Session Autopilot controller */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AutopilotController"];
                };
            };
        };
    };
    readonly resumeSessionAutopilot: {
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
            /** @description Resumed Session Autopilot controller */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AutopilotController"];
                };
            };
        };
    };
    readonly tickSessionAutopilot: {
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
            /** @description Advanced Session Autopilot controller */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AutopilotController"];
                };
            };
        };
    };
    readonly listTaskCheckpoints: {
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
            /** @description Task checkpoint history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskCheckpointListResponse"];
                };
            };
        };
    };
    readonly resumeTaskCheckpoint: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly checkpointId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["ResumeTaskCheckpointRequest"];
            };
        };
        readonly responses: {
            /** @description Checkpoint resumed and Conversation advanced */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ResumeTaskCheckpointResponse"];
                };
            };
            /** @description Checkpoint is not the latest resumable state or its budget is exhausted */
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
    readonly getLatestTaskCheckpoint: {
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
            /** @description Latest Task checkpoint */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskCheckpoint"];
                };
            };
            /** @description Session or checkpoint not found */
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
    readonly listSessionTurnMemoryContexts: {
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
            /** @description Immutable per-turn Memory context history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly count: number;
                        readonly items: readonly components["schemas"]["TurnMemoryContextSnapshot"][];
                        /** @constant */
                        readonly schema_version: 1;
                        readonly session_id: string;
                    };
                };
            };
        };
    };
    readonly getSessionTurnMemoryContext: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly contextId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Exact immutable Memory context */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TurnMemoryContextSnapshot"];
                };
            };
        };
    };
    readonly listSessionMemoryOverlays: {
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
            /** @description Session Memory overlays */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly count: number;
                        readonly items: readonly components["schemas"]["MemoryOverlay"][];
                        /** @constant */
                        readonly schema_version: 1;
                        readonly session_id: string;
                    };
                };
            };
        };
    };
    readonly createSessionMemoryOverlay: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    readonly memory_id: string;
                    /** @enum {string} */
                    readonly mode: "next_turn" | "session";
                };
            };
        };
        readonly responses: {
            /** @description Created Memory overlay */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOverlay"];
                };
            };
        };
    };
    readonly revokeSessionMemoryOverlay: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly overlayId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Revoked Memory overlay */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryOverlay"];
                };
            };
        };
    };
    readonly listSessionMemoryRecommendations: {
        readonly parameters: {
            readonly query?: {
                readonly limit?: number;
            };
            readonly header?: never;
            readonly path: {
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Scoped and explainable Memory recommendations */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryRecommendationResult"];
                };
            };
            /** @description Session not found in the selected Workspace */
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
    readonly createSessionMemoryRecommendationFeedback: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly recommendationId: string;
                readonly sessionId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @enum {string} */
                    readonly action: "use_next_turn" | "keep_for_session" | "dismiss_for_session" | "not_relevant" | "edit_requested" | "forget_requested";
                    /** @enum {string|null} */
                    readonly reason_code?: "useful" | "wrong_task" | "outdated" | "incorrect" | "too_sensitive" | "other" | null;
                };
            };
        };
        readonly responses: {
            /** @description Recorded feedback and optional overlay */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly feedback: components["schemas"]["MemoryRecommendationFeedback"];
                        readonly overlay: components["schemas"]["MemoryOverlay"] | null;
                    };
                };
            };
        };
    };
    readonly reviewSessionMemory: {
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
            /** @description Background review result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MemoryReviewRecord"];
                };
            };
        };
    };
    readonly getSessionCoreMemorySnapshot: {
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
            /** @description Frozen Core Memory snapshot */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["CoreMemorySnapshot"];
                };
            };
            /** @description Session not found in the selected Workspace */
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
    readonly getSessionTaskWorkspace: {
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
            /** @description Durable Project and output-directory binding for the Task */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["TaskWorkspaceResponse"];
                };
            };
        };
    };
    readonly getSessionWorkspaceBinding: {
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
            /** @description Public state of the active Desktop Workspace Binding */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WorkspaceBindingResponse"];
                };
            };
        };
    };
    readonly listSupervisionAlerts: {
        readonly parameters: {
            readonly query?: {
                readonly session_id?: string;
                readonly status?: "open" | "resolved";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Persistent proactive supervision alerts */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["SupervisionAlert"][];
                    };
                };
            };
        };
    };
    readonly resolveSupervisionAlert: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly alertId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Resolved alert */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SupervisionAlert"];
                };
            };
            /** @description Alert not found */
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
    readonly scanProactiveSupervision: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Supervision scan result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SupervisionScanResult"];
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
