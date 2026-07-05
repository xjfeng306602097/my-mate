# Control Plane

Minimal Node/TypeScript control-plane skeleton for My Mate.

Current scope:

- health check
- template registry
- template publish flow
- template derivation, archive, lineage, and next-version draft flow
- agent / skill registry
- rule-based planner template selection
- candidate run plan preview without creating a real run
- create run
- list runs
- mobile home overview
- mobile inbox queue
- mobile run follow-up view
- get run detail
- get run events
- get run artifacts
- get run plan
- get node runs
- list pending approvals
- approve / reject pending approvals
- list pending human input requests
- submit human input payload
- run actions: pause / resume / cancel
- node actions: retry / skip
- internal ops: dispatch sweep proxy for OpenClaw bridge maintenance
- file-backed run plan store
- file-backed node run store
- minimal initial scheduler / frontier materialization
- execution adapter abstraction
- local in-process execution adapter for MVP flow
- OpenClaw execution adapter skeleton
- dispatch envelope / normalized report internal contracts
- automatic ready -> running -> completed transition
- downstream unlock after upstream completion
- simulated failure path for retry testing
- file-backed local store
- OpenClaw bridge dispatch/control config
- OpenClaw report callback endpoint
- file-backed artifact / approval / human-input stores

This service is intentionally small and deterministic.

Additional current behavior:

- `waiting_human` callbacks are normalized into either:
  - approval requests, when the node defines `approval_kind`
  - human input requests, when the node defines `human_input_schema`
- completed callbacks persist artifact metadata under the control-plane data root
- approving or submitting human input re-queues the waiting node for a fresh dispatch attempt
- mobile BFF endpoints are available for phone surfaces:
  - `GET /api/mobile/home`
  - `GET /api/mobile/inbox`
  - `GET /api/mobile/runs`
  - `GET /api/mobile/runs/:runId`
  - `GET /api/mobile/runs/:runId/follow-up`
- planner endpoints are deterministic and only use published templates:
  - `POST /api/planner/template-selection`
  - `POST /api/planner/candidate-plan`
- template versioning endpoints:
  - `GET /api/templates/:templateId/lineage`
  - `POST /api/templates/:templateId/derive`
  - `POST /api/templates/:templateId/new-version`
  - `POST /api/templates/:templateId/archive`
- registry endpoints:
  - `GET/POST /api/registry/agent-profiles`
  - `GET /api/registry/agent-profiles/:profileId`
  - `POST /api/registry/agent-profiles/:profileId/disable`
  - `GET/POST /api/registry/skills`
  - `GET /api/registry/skills/:skillId`
  - `POST /api/registry/skills/:skillId/disable`

Planner behavior:

- `template-selection` scores published templates by token overlap across intent, template name, description, metadata, input keys, and node skills.
- Template scores include a small registry readiness signal so templates with active agent/skill coverage rank ahead of otherwise similar candidates.
- `candidate-plan` compiles a draft `candidate_run` Run Plan and returns validation warnings, but does not write a real run or run-plan record.
- current validation warns on missing required input fields, missing ready frontier, missing terminal node, unknown or disabled agent profiles, unknown or disabled skills, profile-disallowed skills, and missing OpenClaw agent bindings.

Planner providers:

- the planner is now a pluggable provider behind an async `PlannerProvider` interface
- three providers ship with the control-plane:
  - `rule_based_v1` 鈥?deterministic token overlap + registry readiness ranking; always the fallback
  - `local_semantic_v1` 鈥?adds a domain dictionary (coding / research / content / ops / customer / review) on top of `rule_based_v1`, reranks templates and registry recommendations by domain match, and supports both English and Chinese cues; never calls a network LLM. The rerank scores every published template (not only the rule-based top-5) so domain-aligned templates can surface even when their token-based base score is in the fallback band, uses Jaccard-style domain overlap so multi-domain catch-all demos do not shadow single-domain specialists, and treats `metadata.domain` as authoritative when set to a known domain id.
  - `llm_claude_v1` 鈥?calls the Anthropic API to pick a template and rank candidates; only handles `recommendTemplate` (DAG draft and candidate-plan compilation continue to flow through `rule_based_v1` via fallback)
- the active provider is selected via `MY_MATE_PLANNER_PROVIDER` (defaults to `rule_based_v1`)
- if the active provider throws a non-template error, the registry transparently falls back to `rule_based_v1` and annotates the response
- every planner response now includes provenance fields in `planner_context`:
  - `provider_id` 鈥?the provider that produced the result
  - `fallback_used` 鈥?`true` when the response was produced by the fallback after the active provider failed
  - `fallback_reason` 鈥?error message captured at fallback time, when applicable

LLM Claude planner (`llm_claude_v1`):

- requires `ANTHROPIC_API_KEY` to be set; if missing, the provider raises and the registry falls back to `rule_based_v1`
- defaults to model `claude-haiku-4-5` for low-latency template selection; override via `MY_MATE_PLANNER_LLM_MODEL`
- request shape uses Anthropic `tool_use` schema (`select_template` tool) so output is structurally validated; non-tool responses fall back
- per-call timeout is 8s by default; override via `MY_MATE_PLANNER_LLM_TIMEOUT_MS`
- max output tokens defaults to 1024; override via `MY_MATE_PLANNER_LLM_MAX_TOKENS`
- only `recommendTemplate` is implemented 鈥?`generateDagDraft` and `generateCandidatePlan` always throw, which routes those calls through the rule-based fallback
- the LLM is given only published templates' id / name / description / scope (no nodes), keeping prompt size bounded
- if the LLM hallucinates an unknown template id or returns no valid candidates, the registry falls back

Adding a new provider:

1. implement `PlannerProvider` with async `recommendTemplate` / `generateDagDraft` / `generateCandidatePlan`
2. call `registerPlannerProvider(yourProvider)` from a side-effect import
3. re-export it from `src/planner/index.ts`
4. set `MY_MATE_PLANNER_PROVIDER=<your-id>` to enable it

Run Plan compiler registry binding:

- active `AgentProfile` records are resolved before template `agent_profile_bindings`
- `openclaw_agent_id` comes from the active registry profile when available
- node `allowed_skills` are merged with profile `default_skills`, then profile `disallowed_skills` are removed
- node `config.allowed_tools` are merged with profile `allowed_tools`
- disabled or missing profiles fall back to the template binding behavior
- every compiled node and dispatch envelope includes `registry_provenance`, recording agent/source resolution plus skill/tool binding sources for debugging and audit

Execution modes:

- `local`
  - uses the in-process simulation loop
  - best for DAG / scheduler / action testing

- `openclaw`
  - expects an external OpenClaw bridge service
  - the bridge is responsible for translating node dispatch into the Dockerized `openclaw-image` runtime
  - the control-plane exposes `POST /api/internal/openclaw/reports` for bridge callbacks
  - for the current local Docker deployment, the recommended bridge mode is:
    - `MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE=container-exec`
    - bridge-side `MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY=direct-agent`
    - bridge-side `MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL=deepseek/deepseek-v4-pro` for the currently verified local backend path

Recommended OpenClaw integration shape:

`my-mate control-plane -> OpenClaw bridge -> openclaw-image container`

Key env vars for `openclaw` mode:

- `MY_MATE_EXECUTION_ADAPTER=openclaw`
- `MY_MATE_PUBLIC_BASE_URL=http://host:4010`
- `MY_MATE_OPENCLAW_BRIDGE_BASE_URL=http://bridge:port`
- `MY_MATE_OPENCLAW_BRIDGE_API_KEY=...`
- `MY_MATE_OPENCLAW_BRIDGE_SWEEP_PATH=/api/v1/dispatches/sweep`
- `MY_MATE_OPENCLAW_CALLBACK_TOKEN=...`
- `MY_MATE_OPENCLAW_GATEWAY_BASE_URL=http://openclaw-host:18789`
- `MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL=http://openclaw-host:4315`
- `MY_MATE_OPENCLAW_CONTAINER_NAME=openclaw-local`

## Current callback semantics

The control-plane only treats itself as the source of truth for run and node state.
The bridge may report:

- `accepted`
- `running`
- `waiting_human`
- `completed`
- `failed`
- `cancelled`

The control-plane then normalizes these into:

- run state transitions
- node state transitions
- approval or human-input records
- artifact persistence
- downstream node unlock

For `waiting_human`, the control-plane currently fans out by node definition:

- `approval_kind` present -> create approval request
- `human_input_schema` present -> create human input request

Submitting approval or human input re-queues the waiting node for another dispatch attempt.

## Verified isolated OpenClaw bridge topology

The current OpenClaw integration has been verified in an isolated local setup:

- primary user instance left untouched on `4010`
- isolated `control-plane` on `4111`
- isolated `execution-adapter` on `4120`
- local Docker OpenClaw container:
  - name: `openclaw-local`
  - gateway: `18789`
  - approval console: `4315`
  - web console: `7681`

Verified result:

- a published single-node backend template can create a real run
- the run is dispatched through the OpenClaw bridge
- the bridge runs async direct-agent execution in the container
- the latest verified backend path uses `deepseek/deepseek-v4-pro` as the direct-agent model override
- `control-plane` reaches `run.completed`
- event and artifact stores contain:
  - `node.progress`
  - `artifact.created`
  - `node.completed`
  - `run.completed`

The bridge contract is documented in:

- `docs/06-my-mate-openclaw-integration-plan.md`

## Runtime DAG patch confirm / reject

Structured `DagPatchRecord`s generated from runtime interventions can now be confirmed or rejected from the session thread. Confirm dispatches supported patch operations through existing control-plane primitives, scheduler refresh, and execution-adapter notification paths.

Endpoints (also proxied via the api-gateway):

- `POST /api/sessions/:sessionId/patches/:patchId/confirm`
- `POST /api/sessions/:sessionId/patches/:patchId/reject`

Patch state machine:

- `proposed` -> `needs_confirmation` when an intervention is captured
- `needs_confirmation` -> `applied` when every operation succeeds
- `needs_confirmation` -> `applied_with_errors` when at least one operation succeeds and at least one fails
- `needs_confirmation` -> `rejected` after explicit reject
- `unsupported` is a terminal proposal-time state for guidance-only patches

Operations supported by the live apply path:

- `pause_for_replan` calls `applyRunAction(runId, "pause")` and notifies the execution adapter.
- `skip_node` calls `applyNodeAction(runId, nodeRunId, "skip")`, unlocks downstream work, and notifies the adapter.
- `add_node` inserts a compiled runtime step, rewires delivery edges, refreshes ready node runs, and records the resumed topology.
- `change_parallelism` updates `policy_snapshot.max_parallel_nodes`, refreshes scheduler capacity, and can dispatch newly available ready nodes.
- `resume_with_patch` resumes paused runs or refreshes active runs after a patch and records topology before and after the scheduler pass.
- `record_guidance` is accepted as a no-op record.

Natural-language steering currently has deterministic mappings for common
pause, resume, skip, add-step, change, and parallelism requests. The mapper can
target a named node such as `Skip Node B`, extract a clean inserted step label
from text such as `Add a benchmark step before final delivery`, parse explicit
numeric parallelism such as `Set concurrency to 2`, resume a paused run from
`Continue execution now`, and preserve replacement intent such as
`Replace Backend Task with QA pass` for later replanning.

Confirm requests with `apply_supported: false` return `409 patch_not_apply_ready`. Already-resolved patches (`applied`, `applied_with_errors`, `rejected`, `unsupported`) return `409 patch_already_resolved` on either endpoint.

Each confirm/reject also appends an orchestrator text message to the session thread, refreshes `latest_orchestrator_intent` to `patch_applied` / `patch_applied_with_errors` / `patch_rejected`, and updates the session `pending_decision`.

## Internal ops

For the OpenClaw bridge path, the control-plane now exposes:

- `POST /api/internal/ops/execution/dispatch-sweep`

Behavior:

- in `openclaw` adapter mode, proxies to the bridge `POST /api/v1/dispatches/sweep`
- returns the bridge summary: `scanned / normalized / resumed / aligned / finalized`
- in `local` adapter mode, returns `409 maintenance_unsupported`

Smoke verification script:

- `node scripts/restart-recovery-smoke.mjs`

It starts isolated `control-plane` and `execution-adapter` instances on `4111/4120`, seeds persisted dispatch records, verifies adapter startup recovery, and then verifies the control-plane proxy can trigger bridge maintenance sweep.
