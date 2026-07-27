# Unified Orchestration Protocol

The canonical orchestration path is:

`MissionSpec -> OrchestrationDecision -> DagProposal -> DagDefinition revision -> AgentDag`

## Authority boundaries

- `MissionSpecContract` is the task truth used for planning.
- `OrchestrationDecision` records whether orchestration is direct, template-backed, dynamically generated, or manually authored, together with capability, risk, and confirmation evidence.
- `DagProposalRecord` is the durable review container. Template selection, model planning, and manual authoring all produce the same record.
- `DagDefinition` is editable and contains Agent selectors rather than credentials or resolved deployments.
- Proposal confirmation validates the whole graph, resolves every selected immutable Agent version, intersects permissions, and compiles one durable `AgentDag`.
- `AgentDag` is execution state. It contains pinned `AgentBindingSnapshot` values and cannot silently follow later Agent edits.

## Creation paths

Template and planner-backed creation normalizes the generated Workflow graph into a versioned `DagDefinition`. The Main Agent uses the atomic `dag_propose` tool to submit a complete graph in one tool round. Manual authoring starts in the visual DAG editor, publishes a reusable template, and enters the same proposal endpoint when selected for a Task.

The incremental `dag_create` and `dag_add_task` tools and direct `/api/agent-dags` creation remain compatibility surfaces. New Main Agent prompts and Studio entry points should use proposals.

## Confirmation and compilation

Compilation is fail-closed and idempotent by Proposal id. It performs all structural and Agent binding validation before creating an Agent DAG. Runtime node ids are mapped from stable definition node ids, while the source ids remain in Task context and node metadata for lineage.

If materialization fails after a draft is created, the compiler removes the draft DAG, Task records, and protocol messages. A failed confirmation leaves the Proposal in `review_ready`.

AgentDag executes Agent, Reviewer, and native `human_gate` nodes. A Human Gate creates a durable AgentDag Gate record, moves the DAG to `waiting_human`, and never invokes a model on behalf of the operator. Approval or structured input is persisted through the Gate API; an auto-resume Gate continues the same pinned DAG after resolution.

## Stateful routing

`DagDefinition` remains acyclic and adds bounded state-machine semantics without introducing a second scheduler:

- `state_schema` and `initial_state` define the durable graph state contract.
- Agent results are parsed into structured output when possible and are always projected under `state.nodes.<node_id>`.
- `state_output` mappings reduce node output into shared state with `replace`, `merge`, or `append` reducers.
- Node conditions read shared state through explicit paths and can skip branches without treating them as failures.
- `all`, `any`, and `quorum` joins control fan-in readiness while preserving the original `depends_on` compatibility field.
- Reviewer nodes return a structured verdict with criteria, issues, and required revisions; the legacy text verdict remains a compatibility fallback.

Arbitrary runtime cycles remain invalid. Reflection and rework must use bounded retry, a reviewed Proposal revision, or a child DAG. This keeps budgets, permissions, lineage, and recovery auditable.

## Execution

Proposal-backed Session execution is no longer compiled a second time through the legacy template runner. `POST /api/sessions/:sessionId/runs` recognizes a confirmed Proposal, loads its `compiled_agent_dag_id`, returns `202` without holding the UI request open, and starts the pinned `AgentDagRunner` graph. Start and terminal DAG cards are projected back into the owning Session, while the Agent DAG, Agent Tasks, Agent Runs, protocol messages, reviewer verdicts, budgets, and artifacts remain the execution source of truth.

Confirmed Proposals are immutable. Assignment changes are accepted only in `draft` or `review_ready`; a material revision must create or supersede a Proposal and compile a new AgentDag. This prevents reviewed `DagDefinition.revision` state from drifting away from its pinned runtime graph.

`POST /api/agent-dags/:dagId/run` returns `202` for accepted background work,
`409` for an unresolved Human Gate, and an immediate terminal response for an
already completed, failed, or cancelled graph. Tool budgets charge actual
Conversation tool rounds, with persisted Conversation Actions as the recovery
floor; they do not reserve every node's maximum budget as consumed usage.

Main Agent Proposal tools are forced to converge. While a Session has an
unresolved Proposal, a repeated `dag_propose` returns that Proposal instead of
creating a competing graph. Tool-facing Proposal results expose only the
Proposal id, status, optional compiled AgentDag id, and the valid next action.
A `DagDefinition` id is never accepted as an executable DAG id; after user
confirmation it is resolved to the compiled AgentDag, otherwise the tool returns
an explicit `agent_dag_not_confirmed` boundary.

State projection accepts source paths relative to node output and the legacy
`output.<field>` spelling. On retry or restart, missing shared state is rebuilt
from durable completed-node AgentResults before downstream nodes run. Declared
single-field output contracts also support bounded recovery from model JSON
whose string value contains unescaped quotes. Reviewer prompts require both the
standard verdict fields and every exact field in the node output contract.

## Migration

Legacy Session DAG Proposals are upgraded on detail read or confirmation by deriving a canonical decision and definition from their stored planner draft and assignments. The old `dag_draft` and `agent_profile` fields remain compatibility inputs only.

Direct template and pre-Proposal Session plans continue through the legacy Workflow runner during migration. Proposal-backed calls now execute only through AgentDag. A read-only legacy Run projection can be added if an older external client still requires the old response shape; Studio consumes the canonical AgentDag response. After one release reports zero fallback reads, the old Workflow Proposal compatibility fields can be removed.
