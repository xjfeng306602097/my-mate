# Control Plane

Minimal Node/TypeScript control-plane skeleton for My Mate.

Current scope:

- health check
- dashboard summary endpoint
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
- shared JSON storage backend seam for persisted stores
- minimal initial scheduler / frontier materialization
- execution adapter abstraction
- local in-process execution adapter for MVP flow
- OpenClaw execution adapter skeleton
- dispatch envelope / normalized report internal contracts
- automatic ready -> running -> completed transition
- downstream unlock after upstream completion
- simulated failure path for retry testing
- default file-backed JSON local store
- OpenClaw bridge dispatch/control config
- OpenClaw report callback endpoint
- storage backend replacement test coverage for current JSON stores
- canonical run route and explicit compiled work-package identity
- initialization-safe run bundle persistence
- ordered runtime lifecycle events and frozen evidence snapshots
- cursor-based run supervision
- quick, Docker, and model Doctor diagnostics
- persisted pipeline scorecards
- trusted Gateway identity verification and request-scoped workspace tenancy
- centralized workspace RBAC and tamper-evident audit events

This service is intentionally small and deterministic.

Persistence:

- persisted Control Plane stores currently use the shared JSON storage backend
  seam and default to `MY_MATE_STORAGE_BACKEND=file-json`
- supported backend kinds are:
  - `file-json` / `file` / `json`
  - `sqlite` / `sqlite-json` / `db`
- the sqlite backend persists JSON records into a single SQLite database file
  at `MY_MATE_SQLITE_PATH`, defaulting to
  `<MY_MATE_DATA_DIR>/_storage/control-plane.sqlite3`
- the sqlite backend uses a local Python 3 runtime with stdlib `sqlite3`; set
  `MY_MATE_STORAGE_PYTHON` when the default interpreter detection is not enough
- storage snapshots provide the current migration bridge:
  - `npm run storage:export -- <snapshot.json>`
  - `npm run storage:import -- <snapshot.json>`
- snapshots preserve relative paths under `MY_MATE_DATA_DIR`, so the same
  export/import path can be reused across `file-json` and `sqlite`
- practical migration flow:
  - export with the source backend active
  - switch `MY_MATE_STORAGE_BACKEND=sqlite`
  - optionally set `MY_MATE_SQLITE_PATH` and `MY_MATE_STORAGE_PYTHON`
  - import the same snapshot into sqlite
- legacy records without workspace ownership are migrated idempotently into
  the `default` workspace during application startup

Identity and tenancy:

- set `MY_MATE_INTERNAL_AUTH_SECRET` to the same value used by API Gateway
- with a secret configured, direct unsigned `/api` calls are rejected
- signed contexts expire after five minutes and are reconciled against the
  persistent workspace membership before permissions are recalculated
- without a secret, direct development mode remains available and uses the
  requested or `default` workspace
- cross-workspace direct resource access returns `404`
- workspace/member/audit endpoints are:
  - `GET /api/auth/me`
  - `GET/POST /api/workspaces`
  - `GET /api/workspaces/:workspaceId/members`
  - `PUT /api/workspaces/:workspaceId/members/:principalId`
  - `GET /api/audit-events`
- the last active workspace owner cannot be demoted or revoked
- audit events are chained per workspace with SHA-256 and expose a
  `chain_verified` result

Additional current behavior:

- operational summary endpoints are available for runtime posture checks:
  - `GET /health`
  - `GET /api/dashboard/summary`
- Dashboard observability queries support:
  - `window_hours=1..720`
  - `status=all|active|terminal|completed|failed|cancelled`
  - `correlation_limit=1..100`
  - `compare=none|previous` (`previous` requires `window_hours`)
  - example: `GET /api/dashboard/summary?window_hours=168&status=failed&correlation_limit=20&compare=previous`
- omitting `window_hours` preserves the original all-run reliability scope;
  clients that want a bounded view should send the window explicitly
- Dashboard aggregation uses one persisted observability index per run under
  `<MY_MATE_DATA_DIR>/observability-run-index`; writes to run, event, runtime
  job, worker evidence, scorecard, or evaluation stores mark that run under
  `<MY_MATE_DATA_DIR>/observability-dirty`
- missing, dirty, malformed, or stale indexes rebuild lazily during the next
  Dashboard query; response `observability.query` metadata reports indexed and
  rebuilt run counts so operators can distinguish cold and warm queries
- derived observability indexes default to a 2160-hour (90-day) retention
  window; set `MY_MATE_OBSERVABILITY_RETENTION_HOURS` to a positive hour count
  or `0` for unlimited retention
- retention applies to bounded Dashboard queries and removes only derived
  observability indexes and dirty markers; canonical runs, events, evidence,
  scorecards, and evaluations are retained
- unbounded legacy Dashboard requests bypass index retention to preserve the
  original all-history reliability scope and can rebuild an old index on demand
- `compare=previous` returns the immediately preceding equal-length period,
  per-metric deltas/directions/outcomes, and complete/partial coverage metadata
  when retention shortens the comparison period
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

## Regression tiers

- `cd services/control-plane && npm test` is a local Control Plane regression
  suite. It uses an in-process server plus stubbed execution adapters, so it
  does not require Docker and does not prove the real OpenClaw container path.
- Real OpenClaw coverage requires Docker/OpenClaw to be running and should use:
  - `node scripts/openclaw-isolated-e2e.mjs`
  - `node scripts/restart-recovery-smoke.mjs`

## Provider-neutral Docker worker runtime

Set `MY_MATE_RUNTIME_DISPATCHER=docker-worker` to use the Manager -> Docker
Worker mainline. The Control Plane provisions one worker per dispatch attempt,
waits for WebSocket registration, validates capabilities, sends the job, and
releases the lease on terminal, stale, rejected, or recovery paths.

Runtime configuration:

- `MY_MATE_RUNTIME_WORKER_IMAGE` selects the default worker image.
- `MY_MATE_RUNTIME_DEFAULT_TARGET_KIND=docker-worker` makes non-OpenClaw agents use Docker workers.
- `MY_MATE_RUNTIME_WORKER_MANAGER_WS_URL` overrides the Manager URL visible from containers.
- `MY_MATE_RUNTIME_MANAGER_ID` optionally sets the stable Docker ownership label; by default it is derived from `MY_MATE_DATA_DIR` so isolated Control Plane instances do not reconcile each other's Workers.
- `MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV` names host environment variables to inject with Docker `-e NAME` without putting their values in command arguments.
- `MY_MATE_RUNTIME_WORKER_MAX_CONCURRENT` sets the global active Worker limit (default `4`).
- `MY_MATE_RUNTIME_WORKER_QUEUE_LIMIT` bounds the FIFO provisioning queue (default `100`).
- `MY_MATE_RUNTIME_WORKER_QUEUE_TIMEOUT_MS` bounds queue wait time (default `120000`).
- `MY_MATE_RUNTIME_WORKER_HEALTH_TIMEOUT_MS` bounds the container-internal health probe (default `15000`).
- `MY_MATE_RUNTIME_WORKER_DEFAULT_CPUS`, `MY_MATE_RUNTIME_WORKER_DEFAULT_MEMORY_MB`, and `MY_MATE_RUNTIME_WORKER_DEFAULT_PIDS` set fallback container limits (defaults `1`, `1024`, and `256`).
- `MY_MATE_RUNTIME_RETRY_DELAY_MS` controls bounded automatic retry delay for Worker failures.

Node config can provide `worker_image`, `worker_env`, `required_capabilities`,
and `resource_limits` (`cpus`, `memory_mb`, `pids`). A run input named
`project_local_repo` is mounted as `/workspace`; otherwise the provisioner uses
a per-run workspace under the Control Plane data directory.

Docker provisioning uses a global FIFO capacity queue. Run and node actions
cancel matching queued work, and capacity is returned only after Docker confirms
the container was removed or was already absent. Cleanup moves leases through
`cleanup_pending` and either `released` or `cleanup_failed`; failures retain
their capacity allocation and error evidence for the next idempotent attempt.
Every container receives
`--init`, `--cap-drop ALL`, `no-new-privileges`, CPU, memory, and PID limits.
A Worker is ready only after both Worker Hub registration and a successful
container-internal `/health` probe. Runtime Summary exposes active/limit and
queue depth/limit/timeout plus cleanup and reconciliation posture. Docker Doctor
also verifies positive capacity, crash-compensation health, and that the
configured image declares a healthcheck.

Before the Control Plane starts accepting requests, Docker inventory is read
from `my-mate.runtime-worker=true`, `my-mate.manager-id`, `my-mate.run-id`, and
`my-mate.job-id` labels. Active, stale, pending, and failed-cleanup leases are reconciled across
active, terminal, and missing Run records; labeled orphan containers are also
removed. The reconciliation result is persisted under diagnostics, and each
matched Run receives idempotent `lease.cleanup_started`,
`lease.cleanup_completed`, or `lease.cleanup_failed` audit events. Interrupted
running nodes are retried only after compensation succeeds. Inventory or cleanup
failure blocks redispatch and remains visible in Runtime Summary, Doctor,
Dashboard, and Settings. Heartbeat-expired workers use the same cleanup path.

Real Docker recovery verification:

- `npm run runtime-worker:recovery-smoke`

The smoke starts an isolated Control Plane, leaves one leased Worker container
and one labeled orphan across an abrupt restart, then verifies both containers
are removed, the lease is released, and no cleanup failure remains.

## P0 Runtime Truth And Operator Loop

Every newly created run persists a canonical route snapshot, initial plan,
effective plan, compiled work packages, node runs, creation events, and an
initialization marker before dispatch. Direct template routes use
`template:<template-id>@<version>`; proposal and session flows preserve their
own source identity. Legacy work-package inference is confined to compatibility
reads for old stored plans.

Runtime events use a monotonic per-run sequence and carry idempotency,
correlation, and causation metadata. Job, Worker, lease, handoff, evidence, and
cleanup transitions are retained in the raw event journal. Frozen evidence
snapshots are schema-validated, redacted, content-addressed, and only become
settled after terminal resource cleanup plus the configurable
`MY_MATE_EVIDENCE_SETTLE_QUIET_MS` quiet window (default `500`).

Operator endpoints:

- `POST /api/diagnostics/doctor`
- `GET /api/runs/:runId/route`
- `GET /api/runs/:runId/supervise?cursor=<opaque>&limit=100`
- `POST /api/runs/:runId/scorecards`
- `GET /api/runs/:runId/scorecards`
- `GET /api/runs/:runId/scorecards/:scorecardId`

The built-in `pipeline-v1` scorecard evaluates 14 route, plan, runtime,
handoff, artifact, and cleanup invariants. Results are persisted and
deduplicated by evidence digest, profile, and policy version. Advisory and
strict gate verdicts are separate from run status, and incomplete diagnostic
snapshots require an explicit request.

Doctor reports `runtime_ready`, `deterministic_ready`, `model_ready`, and
`model_verified` independently. Docker mode checks the client, daemon, image,
protocol label, mount I/O, and disposable Worker registration. Model mode
checks host configuration and credential presence; its live provider probe is
opt-in. It does not yet prove that provider binaries are installed inside an
arbitrary custom Worker image, which belongs to the P1 provider-native path.

## P1-D1 Evidence Protocol V2

The Manager accepts both legacy evidence and additive Evidence V2 on the same
runtime protocol. New records retain per-job sequence, provider/model source,
native event identity, trace/span/tool correlation, input/output references,
usage availability, and redaction status. Legacy records are normalized to
schema version 1 with unknown synthetic source metadata.

Persistence performs defense-in-depth secret redaction, enforces the 32 KiB
inline limit, validates the normalized JSON Schema, and deduplicates native
events by `(job_id, native_event_id)`. Supervise deltas expose the normalized
metadata. Usage completeness only becomes complete for provider-reported
available usage; a synthetic `usage` record with `availability=unavailable`
remains honestly unavailable.

## P1-D2 Provider Adapters And Cost Projection

The Worker now supplies provider-native Evidence V2 for Codex, Claude SDK,
Kimi, and OpenClaw. On persistence, the Control Plane keeps provider-reported
cost separate and may add an estimate from an exact provider/model match in a
versioned pricing catalog. The built-in catalog is intentionally empty; set
`MY_MATE_PRICING_CATALOG_PATH` to a validated JSON catalog to enable estimates.
Unknown aliases and models remain `estimated_cost=null`.

`GET /api/runs/:runId/runtime` now returns projection version 2 with native
evidence count, latest usage per model job, aggregate known token values,
token/provider-cost/estimated-cost completeness, tool calls/results, and open
tool-call IDs. Frozen evidence snapshots mark cost complete only when every
model job has either provider-reported or catalog-estimated cost.

Recorded fixtures cover all four adapters without credentials. Live provider
tests remain opt-in and independent of Doctor deterministic readiness.

## P1-C1 Policy And Evaluation

Template scorecard policy supports validated data-only checks for required
evidence, tools, artifact metadata/contracts, handoff JSON Schema, structured
test categories, and deterministic assertions. Arbitrary scripts are rejected.
Scorecards expose `pipeline_verdict` and `contract_verdict` independently;
strict contract errors reject the gate without changing source run status.

Evaluation endpoints persist pipeline, contract, evidence, usage, quality, and
gate verdicts independently:

- `POST /api/runs/:runId/evaluations`
- `GET /api/runs/:runId/evaluations`
- `GET /api/runs/:runId/evaluations/:evaluationId`

Built-in evaluators are `none`, `deterministic-v1`, and `model-v1`. Model
evaluation uses a view that excludes raw inline provider payloads, runs outside
the source DAG, records evaluator model/prompt/usage, retries through a
persisted queue, and recovers queued or stale work after restart. Provider or
parse failures persist `quality_verdict=error`.

`model-v1` requires an explicit request and `ANTHROPIC_API_KEY`. Configure it
with `MY_MATE_EVALUATOR_MODEL`, `MY_MATE_EVALUATOR_MAX_TOKENS`, and
`MY_MATE_EVALUATOR_TIMEOUT_MS`. Live evaluator tests remain disabled unless
`MY_MATE_RUN_LIVE_EVALUATOR_TESTS=true`.

## P1-C2 Trace And Replay

Trace is a deterministic projection from lifecycle events, Evidence V2,
handoffs, and artifacts. It never scans chat text for provider-specific data.
The bounded endpoint supports node/kind filters and an opaque cursor:

- `GET /api/runs/:runId/trace`

Audit replay reduces the immutable route, initial plan, and ordered V2 event
journal without invoking a provider or Worker. It compares run, plan, node,
job, Worker, lease, handoff, artifact, evidence, gate, and applied-patch
projections. Complete V2 journals return `pass` or `fail`; missing legacy
sequence/initial-plan truth returns `partial`.

- `POST /api/runs/:runId/replays`
- `GET /api/runs/:runId/replays/:replayId`
- `POST /api/runs/:runId/replay-plans`
- `GET /api/runs/:runId/replay-plans/:replayPlanId`
- `POST /api/runs/:runId/reruns`

Replay plans only produce categorized recommendations. They do not mutate
templates, prompts, policies, or assignments. Reruns clone the frozen
effective plan, preserve the original route ID, persist `source_run_id`, merge
explicit input overrides, and deduplicate retries through `Idempotency-Key`.
