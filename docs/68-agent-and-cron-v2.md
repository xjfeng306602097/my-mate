# Agent and Scheduled Task V2

This document records the runtime contract introduced after the M11 memory and M12 skill work.

## Agent model

`ProviderConnection` remains an authentication and transport record. It is not the execution subject.

The execution subject is an `AgentDefinition` with immutable `AgentVersion` records. A version contains the prompt/persona, model policy, tool and skill policy, memory policy, context continuation policy, runtime/sandbox policy, workspace policy, autonomy ceiling, and artifact/delivery policy.

`ModelDeployment` is a normalized projection of one model on one Provider Connection. It stores a non-secret connection revision so a pinned binding can detect provider drift.

Every Session, Workflow node, and Scheduled Task resolves to an `AgentBindingSnapshot`. The snapshot contains no credentials and is immutable. Secrets are resolved just in time from the Provider Connection secret store. A manual model switch creates a fresh snapshot; an existing pinned snapshot cannot silently change.

`AgentRun` is the common observability record for Conversation, Workflow node, Schedule, and continuation executions. It records the binding digest, parent relationship, lifecycle status, and error evidence.

## Compatibility migration

The first read of a workspace projects legacy `AgentProfile` records into `AgentDefinition@1`, and Provider Connections into Provider Definitions and Model Deployments. Existing sessions without a snapshot are lazily bound at their next execution. Legacy records remain readable and writable during the migration window.

The compatibility path can materialize a minimal Agent from a verified Connection when an older installation has no Agent Profile. This keeps existing Sessions usable while the user configures a first-class Agent.

## Scheduled Task V2

The stored schedule keeps the legacy `recurrence` field for compatibility and also exposes a normalized `trigger_spec`:

- `once_after` with a delay in seconds
- `once_at` with an ISO timestamp and IANA timezone
- `interval` with seconds
- `cron` with expression and timezone

Each schedule stores a self-contained prompt, an Agent binding snapshot, a permission/preauthorization snapshot, retry and concurrency policy, source lineage, and the expected delivery policy. The scheduler validates the pinned Connection before execution and fails closed on drift. A scheduled child cannot recursively create another schedule.

Natural-language scheduling remains a model responsibility: the current Conversation Agent calls the structured scheduling tool. The Control Plane validates time, binding, permissions, and persistence. Client-side intent classification is not authoritative.

## API surface

- `GET /api/agents` returns versioned Agent definitions and model deployments.
- `GET /api/agents/:agentId` returns the selected Agent version.
- `POST /api/agents` publishes a new immutable Agent version.
- `POST /api/agents/:agentId/bind` creates a binding snapshot for inspection or downstream execution.
- `GET /api/agent-runs` exposes unified execution evidence.
- Schedule APIs accept `trigger_spec` in addition to the legacy `recurrence` shape.

## Rollout phases

1. Read projection and Session binding (implemented).
2. Conversation Agent factory and AgentRun evidence (implemented).
3. Workflow compiler and dispatch envelope binding (implemented).
4. Schedule trigger normalization and pinned execution (implemented).
5. Studio Agent registry, Team and durable Agent DAG surface (implemented).
6. Remove temporary legacy fallbacks only after every Workflow node has a valid binding snapshot and migration diagnostics report zero unresolved nodes.

## Multi-Agent and durable DAG contract

`OrchestratorProfile` is now a compatibility projection into an immutable
`AgentDefinition` version whose Role is `orchestrator`. First-class Roles are
`orchestrator`, `supervisor`, `worker`, `reviewer`, and `specialist`. An
`AgentTeam` pins member versions and rejects Role mismatches; its policy owns
concurrency, delegation depth, AgentRun/tool/runtime budgets, reviewer
requirements, and cancellation inheritance.

Main Agents use structured `dag_create`, `dag_add_task`, `dag_status`,
`dag_run`, `dag_cancel`, and `delegate_task` tools. Every dynamic delegation
creates durable Agent DAG, Agent Task, protocol-message, AgentRun, Agent Result,
and Artifact-reference records before execution. Sub Agents run in fresh hidden
Sessions and can only receive the intersection of parent, Team, and Agent
permissions. An empty tool intersection means no tools; it never expands to the
global tool registry.

Agent Protocol messages are idempotent envelopes with correlation and causation
ids. Worker results remain unverified until a Reviewer returns an explicit
`REVIEW_VERDICT`. Rejection moves the DAG to `waiting_human`; recovery resets
only failed or blocked nodes and increments AgentRun attempts. Cancellation
uses an AbortSignal, marks active AgentRuns, and cascades to child DAGs when the
Team policy allows it.

## Workflow migration gate

Legacy Workflow nodes are backfilled in place with `agent_id`, `agent_version`,
and a pinned `AgentBindingSnapshot`. `agent_profile` remains during the dual-read
window. `GET /api/agents` reports migration counts and unresolved nodes. The
compatibility field can be removed only after all of the following are true:

1. Every stored Workflow node has a schema-v2 snapshot with `agent_role`.
2. Migration reports zero unresolved nodes across every Workspace.
3. New Workflow authoring no longer writes `agent_profile`.
4. Restore and rollback tests pass against the pre-migration backup.
5. A release has observed no legacy fallback reads.

## Studio surface

The primary `Agents` page creates versioned Agents and execution policies, builds and edits
durable DAGs, starts execution, shows dependency and binding snapshots, streams
Agent Protocol records, cancels work, and retries failed nodes. Agent Role is
read from the published Agent version rather than inferred from legacy Profile
metadata.

## P0-P1 closure

Agent readiness is fail-closed across publishing, binding, discovery, and the
default execution policy. A ready Agent requires available locked Skills,
registered tools, an active and verified Provider Connection, configured
credentials, and a usable model. Legacy Skill and tool aliases are migrated to
canonical capabilities before readiness is evaluated.

The bundled execution policy is created only when a Workspace has no user
policy. It selects ready orchestrator, worker/specialist, and optional reviewer
versions and applies bounded concurrency, delegation depth, AgentRun, tool, and
runtime budgets. Studio presents this as an optional execution policy; `Team`
remains an internal protocol record rather than a required user concept.

Terminal Agent DAGs are reduced by the pinned Main Agent in a hidden synthesis
Session. The resulting user-facing summary, Reviewer verdict, durable Artifact
references, and reduce-phase AgentRun are projected back into the parent Task.
Sub Agent artifacts are also projected into the Task Workboard.

On 2026-07-19 the live Desktop acceptance used `glm-5.2` to create and run a
two-Worker plus Reviewer DAG. The two Workers ran concurrently, the Reviewer
rejected missing shared state honestly, recovery rebuilt state from persisted
Worker results without rerunning them, the Reviewer then accepted, and the Main
Agent produced one idempotent final synthesis. The completed graph recorded five
AgentRun attempts and 26 actual tool rounds.
