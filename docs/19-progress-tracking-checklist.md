# My Mate Progress Tracking Checklist

This document turns the current status write-ups into a durable working
checklist that can be updated as implementation moves forward.

It is intended to answer one operational question:

what is already shipped, what is still open, and what should be tracked next?

It builds on:

- [`docs/08-current-status-and-next-steps.md`](/C:/project/my-mate/docs/08-current-status-and-next-steps.md)
- [`docs/12-phased-implementation-plan.md`](/C:/project/my-mate/docs/12-phased-implementation-plan.md)
- [`docs/14-hermes-desktop-gap-analysis-and-next-iteration-plan.md`](/C:/project/my-mate/docs/14-hermes-desktop-gap-analysis-and-next-iteration-plan.md)
- [`docs/18-openclaw-end-to-end-flow.md`](/C:/project/my-mate/docs/18-openclaw-end-to-end-flow.md)

## How To Use This Checklist

1. Keep the `Shipped baseline` sections as a record of capabilities that are
   already implemented and locally validated.
2. Track new work in the `Open tracking board` with a stable task id.
3. Only move a task into the shipped baseline after code, tests, and a visible
   user-facing or operational outcome all exist.
4. When a task closes, add the verification command, doc link, or code link in
   the `Notes` column.
5. Append owner and target date inline when needed, for example:
   `Owner: Alice | Target: 2026-07-19`.

## Snapshot

Current tracking snapshot date:

- `2026-07-11`

Current validated local checks:

- `packages/shared-types`: `npm run check`, `npm test`
- `apps/mobile`: `npm run check`, `npm test`
- `apps/studio`: `npm run check`
- `services/api-gateway`: `npm run check`, `npm test`
- `services/execution-adapter`: `npm run check`, `npm test`
- `services/control-plane`: `npm run check`, `npm test`
- `services/runtime-worker`: `npm run check`, `npm test`
- `apps/cli`: `npm run check`, `npm test`
- repository: `npm run check`, `npm run build:runtime`, `npm test`
- real Docker Worker path: `npm run runtime-worker:smoke`

Validation boundary:

- the checks above are local package checks; `services/control-plane npm test`
  uses stubbed execution adapters and does not require Docker/OpenClaw
- real OpenClaw regression remains a separate gate:
  `node scripts/openclaw-isolated-e2e.mjs` and
  `node scripts/restart-recovery-smoke.mjs`
- the Docker Worker smoke is a real isolated Control Plane + Gateway + CLI +
  Docker acceptance flow; it does not require a model credential and does not
  claim semantic model quality
- the latest Docker Worker smoke also verifies the Gateway runtime,
  scorecard, evaluation, trace, and replay read surfaces against the same real
  run before the isolated services are released

Current read of the repository:

- core MVP orchestration loop exists
- Mission / Session / Run projections exist
- mobile and Studio surfaces are usable today
- OpenClaw bridge path is implemented and locally verified
- main remaining work is productionization plus planner/orchestrator evaluation
  and productization

Latest implementation update:

- `HR-P0` HomeRail-alignment runtime foundation and operator loop landed
  - canonical route snapshots prevent direct template runs from becoming
    `Unrouted`; compiled nodes retain declared or honest default work packages
  - run creation persists the route, initial/effective plan, node runs, ordered
    creation events, and initialization marker before dispatch
  - event journal V2 covers job, Worker, lease, handoff, evidence, and cleanup
    transitions with monotonic run sequences and idempotency metadata
  - frozen evidence snapshots are redacted, schema-validated, settled, and
    addressed by a stable SHA-256 digest
  - Doctor exposes independent runtime, deterministic, model-ready, and
    model-verified results; live provider probing is opt-in
  - supervise provides bounded cursor pagination and terminal settling through
    both API and CLI
  - `pipeline-v1` persists and deduplicates a 14-check scorecard with advisory
    or strict gate verdicts
  - Gateway allowlist and `@my-mate/cli` cover doctor, run, supervise, and
    scorecard without direct Control Plane access
  - `npm run check`, `npm run build:runtime`, `npm test`, and the real Docker
    Worker smoke all pass
- `HR-P1` HomeRail-alignment P1 slices are complete
- `HR-P1-D1` Evidence Protocol V2 landed
  - shared `HarnessClient` supports async semantic evidence emission
  - new Worker records carry schema version, sequence, source, trace,
    input/output refs, usage availability, and redaction status
  - local and unrecognized command/OpenClaw fallbacks are explicitly synthetic
    and report unavailable usage with null token/cost values
  - Worker and Control Plane perform separate secret-redaction passes; payloads
    above 32 KiB are externalized or marked blocked
  - the Manager accepts V1 evidence and deduplicates V2 native events by job
    and native event identity
  - normalized evidence is JSON-Schema validated and exposed in supervise
    deltas; unavailable usage no longer counts as complete
- `HR-P1-D2` Provider Adapters landed
  - Codex JSONL/app-server, Claude SDK, Kimi stream/ACP/SDK, and OpenClaw bridge
    records normalize into provider-native Evidence V2
  - command stdout is parsed while the process runs; unknown output retains the
    D1 synthetic fallback and missing provider usage stays explicitly unavailable
  - tool calls/results retain stable IDs, complete text/thinking is aggregated,
    and native model turns/errors are persisted
  - exact-match versioned pricing uses decimal arithmetic; unknown models stay
    null and provider-reported cost remains separate
  - runtime projection V2 exposes latest usage, token/cost completeness, native
    evidence count, and open tool calls
  - credential-free recorded fixtures run by default; live providers are
    verified only through the explicit opt-in runner
- `HR-P1-C1` Policy And Evaluation landed
  - declarative checks are JSON-Schema validated and reject executable or
    unknown check types
  - scorecards retain independent pipeline and contract verdicts; strict
    contract failures can reject without changing run status
  - persisted evaluations expose pipeline, contract, evidence, usage, quality,
    and gate verdicts without a collapsed PASS field
  - `none`, `deterministic-v1`, and opt-in `model-v1` evaluators share one
    registry and state machine
  - model judge inputs exclude raw inline payloads; provider/parse errors become
    quality `error` after the retry budget
  - API Gateway and CLI support polling, and deterministic Docker smoke proves
    quality remains `not_evaluated`
- `HR-P1-C2` Trace And Replay landed
  - first-class trace projection covers run, node, job, model, tool, handoff,
    artifact, and control spans without scanning chat text
  - a pure reducer reconstructs runtime state from the immutable initial plan
    and ordered lifecycle events
  - replay compares run/plan/node/job/Worker/lease/handoff/artifact/evidence/gate
    projections and persists exact differences plus missing references
  - complete V2 runs return pass/fail; legacy sequence or initial-plan gaps
    return partial without claiming exact reconstruction
  - replay-plan creates categorized recommendations without mutating runtime
    policy, prompts, templates, or assignments
  - rerun clones the frozen effective plan, preserves route identity and
    source lineage, merges explicit overrides, and deduplicates with
    `Idempotency-Key`
  - the real Docker smoke exactly replayed 57 events with zero differences and
    zero missing references
- `HR-P1-E1` Shared Layout And Runtime Graph landed
  - authoring, route comparison, and runtime use one deterministic Kahn-depth
    layout with stable coordinates and edge endpoints
  - Studio's graph-first runtime view includes cursor refresh, run controls,
    URL/keyboard node selection, full evidence drawer, and narrow-screen list
    fallback
- `HR-P1-E2` Evaluation UI And Mobile landed
  - Studio scorecard/evaluation/replay actions render independent verdicts,
    findings, replay differences, and missing references
  - Mobile loads runtime projection V2, scorecards, evaluations, trace, and
    replay through Gateway APIs and exposes terminal-run evaluation actions
  - Mobile uses depth/work-package stages with horizontal branch rails,
    convergence signals, and a full-height node evidence Modal
  - the evidence sheet exposes attempts, prompts, native tools, usage/cost,
    handoffs, artifacts, errors, and trace without requiring raw JSON
  - four focused model tests plus 390 x 844, 360 x 800, and 1440 x 900 browser
    acceptance cover failed retries, text fit, overlap, and page overflow

- `MW-00A` first-pass contract document added at
  [`docs/20-mission-workspace-contract.md`](/C:/project/my-mate/docs/20-mission-workspace-contract.md)
- `MW-00B` first-pass Control Plane versioned contract output landed
- `MW-00C` Mobile consumer cleanup landed
  - versioned backend `mission_snapshot` now drives stages, `missionSpec`,
    work packages, artifact surfaces, and workspace section shell
    metadata/order
  - local Mobile mission builders are retained only for
    `workspace_contract_version = 0` fallback and display body adaptation
- `MW-00D` Studio consumer cleanup landed
  - Studio now uses a shared versioned `mission_snapshot` guard
  - Mission Workspace, inspector rail, and mission inventory labels prefer the
    versioned contract before compatibility fields
  - Studio smoke check now guards the contract-version helper/model markers
- `MW-00` final cross-surface stage verification landed
  - Control Plane now has a stage matrix test covering `draft`, `planned`,
    `confirmed`, `running`, `waiting_human`, and `completed`
  - Mobile now has a contract-consumption smoke test guarding the versioned
    `mission_snapshot` path
  - Studio smoke check now guards the versioned spec and section-consumption
    markers
- `MW-01` workspace structure skeleton landed
  - Control Plane now emits the stable 8-module `workspaceSections` order:
    `objective`, `route`, `work_packages`, `checkpoints`, `outputs`,
    `pending_decisions`, `execution_summary`, `evidence_summary`
  - Mobile adapts the same 8 modules as persistent center-workspace sections
    across workspace stages
  - Studio sorts versioned `workspaceSections` by the same 8-module order
- `MW-02` first-class work/checkpoint/output surfaces landed
  - `pipelines`, `checkpoints`, and `outputs` now carry structured stage,
    relation, next-action, and output-history fields
  - Mobile and Studio display those fields inside the center workspace
  - contract tests guard output history, checkpoint relation, and work-package
    linkage
- `MW-03` conversation/evidence role correction landed
  - `mission_snapshot` now carries `conversationRail`, `evidenceSummary`, and
    `rawCardPolicy`
  - Mobile and Studio consume those fields so conversation and raw cards stay
    available as secondary explanation, decision, audit, and drilldown context
  - contract tests and smoke checks guard the collapsed secondary raw-card
    policy
- `PLAN-01` revise-plan understanding expansion landed
  - revise directives can now insert an upfront research/preparation step,
    including before a targeted step
  - explicit worker/parallelism instructions now update the targeted executable
    step and route parallelism policy
  - Control Plane tests guard both new revise-plan paths
- `PLAN-02` planner recommendation quality hardening landed
  - orchestrator profile `default_subagent_profile_ids` now influences planner
    registry synthesis order and node tool selection
  - planner invocation now consumes `planning_policy.max_agent_nodes`,
    `planning_policy.prefer_domain_match`, and
    `handoff_policy.require_review`
  - rule-based and local-semantic draft generation now carry review/default-node
    policy into draft metadata and planner context
  - local-semantic registry synthesis now spreads multi-domain intents across
    uncovered domain coverage before filling the remaining highest-score slots
  - Studio planner and proposal recommendation panels now surface coverage
    domain evidence so operators can see why a profile was selected as a
    domain-coverage fill
  - Mobile route cards and draft registry recommendations now surface the same
    coverage evidence with human-readable domain labels
  - local-semantic registry synthesis now scopes borrowed skills to the selected
    profile's matched domains so multi-domain drafts do not bleed review,
    research, or content skills across agent nodes
  - Control Plane tests now guard policy-driven registry synthesis defaults,
    domain-rerank opt-out behavior, multi-domain coverage selection, the
    preferred-subagent/domain-fit boundary, and profile-scoped skill picking
- `PLAN-03A` deterministic DAG synthesis shape landed
  - local-semantic registry synthesis now orders DAG edges by domain phase
    instead of connecting every agent task directly to `node_end`
  - research/customer context stages now feed execution/content stages, and
    review-domain stages are placed after upstream work
  - same-phase execution domains stay parallel before the terminal stage
  - `require_review` now adds an explicit `node_review_gate` approval node in
    local-semantic registry synthesis
  - Control Plane tests guard research-to-content ordering, peer-domain
    parallelism, review-domain ordering, and explicit review-gate generation
- `PLAN-03B` guarded LLM DAG edge shaping landed
  - `llm_claude_v1` now uses local-semantic DAG synthesis as the safe base for
    DAG draft generation
  - the LLM can only return a `shape_dag` tool call with edges between existing
    node ids; it cannot invent nodes, agents, or skills
  - LLM-shaped edges are accepted only after local checks for known nodes,
    acyclic structure, path-to-end reachability, review-gate preservation, and
    existing template validation
  - unsafe LLM edge output falls back to the deterministic local-semantic DAG
    without tripping global rule-based fallback
  - Control Plane tests guard both accepted LLM edge rewrites and unsafe-edge
    deterministic fallback
- `DATA-01A` storage backend seam landed
  - Control Plane now has a shared JSON storage backend abstraction instead of
    relying only on ad hoc direct file reads/writes
  - `session-store`, `run-store`, and `run-plan-store` now consume that shared
    storage backend seam for core mission workflow persistence
  - this preserves current file-backed behavior while creating a concrete
    migration path for a database-backed backend
  - Control Plane checks and tests stay green after the storage seam refactor
- `DATA-01B` additional core stores migrated behind the shared backend seam
  - `node-run-store`, `event-store`, `template-store`, and `registry-store`
    now read/list through the shared JSON storage backend abstraction
  - approval, human input, orchestrator profile, session thread, attachment,
    artifact, DAG patch, and DAG proposal stores now use the same seam for
    primary read/list/get paths
  - storage backend selection is explicit: `file-json` remains the supported
    default and `sqlite` is now a real database-backed option
  - storage snapshot export/import now provides a concrete migration bridge from
    the current file-json layout into the sqlite backend
  - Control Plane now has a focused backend-replacement test that proves store
    reads/writes can run against a non-filesystem JSON backend
  - this keeps the current file backend intact while making more of the
    persistence surface swappable
- `DATA-02` tenancy and governance sequence landed
  - `DATA-02A/B` adds shared identity contracts, configured Gateway bearer
    identities, workspace selection, and HMAC-signed internal auth context
  - `DATA-02C` adds request-scoped tenant context, store-level isolation,
    trusted actor ownership, cross-workspace `404` behavior, and idempotent
    migration of legacy records into `default`
  - `DATA-02D/E` adds centralized route permissions, persistent membership
    reconciliation, last-owner protection, and per-workspace SHA-256 audit
    chains for allowed, denied, and error outcomes
  - `DATA-02F` adds CLI identity commands/workspace configuration, Mobile
    Account/workspace/member/audit UI, and Studio token/workspace/member/audit
    settings with full tenant-data reload after auth or workspace changes
  - OpenAPI and the generated client include identity, workspace, membership,
    audit, and selected-workspace header contracts
  - isolated Gateway/Control Plane/Studio acceptance verified invalid-token
    recovery, Alpha/Beta data isolation, verified audit state, responsive
    layouts, and clean browser console output
  - implementation and operational details are documented in
    [`docs/28-data-02-tenancy-governance.md`](/C:/project/my-mate/docs/28-data-02-tenancy-governance.md)
- `DATA-03` Registry and policy governance landed
  - workspace policy defaults to advisory mode and can enforce approvals for
    Agent Profile, Skill, and Template publish/archive mutations
  - proposals freeze payload and resource baseline digests, approval count,
    self-approval policy, proposer identity, and audit reason
  - `governance.review` separates review/apply from `registry.manage`; owner
    self-approval is denied by default and operator review is rejected
  - approval and apply are separate evidence-bearing actions; baseline drift
    produces `conflicted` instead of overwriting a concurrent change
  - OpenAPI/generated types, Gateway routes, CLI commands, and the Studio
    policy/proposal/approval workbench cover the complete workflow
  - isolated owner/admin browser acceptance verified staging, self-review
    blocking, approval, apply, Registry refresh, audit-chain verification, and
    responsive desktop/mobile layout
  - implementation and operational details are documented in
    [`docs/29-data-03-registry-governance.md`](/C:/project/my-mate/docs/29-data-03-registry-governance.md)
- `STU-03` desktop context workflow slice landed
  - Studio Context Files now supports drag/drop and file picker intake for
    local desktop file references
  - Studio Workspace Browser now scans mission context files and generated
    outputs, with reusable output-to-context attachment actions
  - Studio smoke checks guard the drop zone, file picker, and workspace browser
    markers
- `OBS-01A` unified dashboard summary slice landed
  - Control Plane `GET /health` now returns runtime storage backend kind and
    execution adapter kind for quick operational checks
  - Control Plane now exposes `GET /api/dashboard/summary` for aggregated
    runtime health, workload counts, intervention backlogs, stale-session
    signals, and recent waiting/failure hotspots
  - API Gateway now proxies the dashboard summary route for Studio/mobile-safe
    client access
  - Studio now exposes a dedicated `Dashboard` mode for the unified workload,
    backlog, and hotspot view
  - Control Plane tests now guard danger vs warn attention tone selection and
    deterministic hotspot ordering for waiting and failed runs
- `OBS-01B` runtime metrics and trace correlation slice landed
  - the existing dashboard summary now adds 24 hourly activity buckets,
    run/job success rates, retry rate, and run/job P50/P95/max/average latency
  - model usage reports token completeness, total tokens, provider-reported
    cost, and estimated cost separately by currency
  - recent-run correlation joins run, trace, ordered events, jobs/retries,
    Evidence V2, scorecard, evaluation, findings, usage, and cost
  - Studio renders a low-noise Runtime Performance strip, 24 Hour Activity,
    and a Trace / Event / Evaluation Correlation table whose rows drill into
    the selected session/run graph
  - Studio and Mobile now select the newest scorecard/evaluation record by
    `created_at` instead of relying on response array position
  - Control Plane integration coverage verifies failure/retry, latency,
    partial usage, token/cost, trace, scorecard, and evaluation correlation
  - browser acceptance passed at 1440 x 900, 390 x 844, and 360 x 800 with no
    document-level horizontal overflow, clipped metrics, or console errors;
    the correlation table scrolls horizontally inside its own container
- `OBS-01C` indexed metrics query slice landed
  - Control Plane now persists one lightweight observability index per run
    instead of rescanning every run's jobs, evidence, events, scorecards, and
    evaluations on every Dashboard request
  - run, event, runtime-job, worker-evidence, scorecard, and evaluation writes
    mark only the affected run dirty; missing, dirty, malformed, or stale
    indexes rebuild lazily and return to the warm path on the next request
  - `GET /api/dashboard/summary` now accepts validated `window_hours` (1-720),
    `status` (`all`, `active`, `terminal`, `completed`, `failed`, or
    `cancelled`), and `correlation_limit` (1-100) query parameters
  - requests without `window_hours` preserve the prior all-run reliability
    scope, while Studio explicitly requests 24 hours and exposes 24h, 7d, and
    30d windows plus run-status filtering
  - activity buckets scale from 60 minutes through 360 minutes to 1440 minutes,
    and the Studio activity title, bucket label, metrics, and correlation rows
    follow the active query
  - OpenAPI and Gateway coverage guard the additive query contract and exact
    query-string forwarding; file-json and SQLite tests guard index-marker
    deletion through the shared storage backend
  - cold/warm browser acceptance observed `57 rebuilt / 57 indexed` followed
    by `57 indexed`; 1440 x 900, 390 x 844, and 360 x 800 checks found no
    document-level horizontal overflow or console errors, and the correlation
    table retains internal horizontal scrolling on narrow screens
- `OBS-01D` retention and period comparison slice landed
  - `MY_MATE_OBSERVABILITY_RETENTION_HOURS` now controls derived observability
    index retention, defaults to 2160 hours (90 days), and accepts `0` for
    unlimited retention
  - retention pruning removes only per-run observability indexes and dirty
    markers; canonical Run, Event, Evidence, Scorecard, and Evaluation records
    are never deleted by the Dashboard path
  - bounded Dashboard requests apply retention while legacy requests without
    `window_hours` keep all-history reliability semantics and may lazily rebuild
    an older index on demand
  - `compare=previous` compares the selected window with the immediately
    preceding equal-length period and returns current, previous, delta,
    change-rate, direction, and improved/regressed/neutral outcome metadata
  - comparison covers run volume, run/job success, retry rate, run/job P95,
    and tokens; coverage is explicit when retention truncates the previous
    period
  - Studio now defaults the Previous Period checkbox on, renders a compact
    six-metric comparison strip, and exposes index-retention status beside the
    warm/rebuilt index badge
  - Control Plane tests prove complete and partial comparison coverage,
    non-destructive pruning, legacy rebuild compatibility, and invalid-query
    rejection; Gateway and OpenAPI cover exact `compare` forwarding
  - browser acceptance passed at 1440 x 900, 390 x 844, and 360 x 800 with no
    toolbar overlap, comparison-strip overflow, document-level horizontal
    overflow, or console errors
- `OBS-02` Agent cost attribution and operational reporting landed
  - Observability Run Index V2 now persists Node, Agent Profile, runtime,
    provider/model, and work-package identity beside Job and usage data
  - effective cost uses provider-reported values first and catalog estimates
    only as fallback; provider and estimated totals stay separately visible
  - completeness explicitly counts costed, provider, estimated-only, and
    unavailable model Jobs without dropping missing evidence
  - Dashboard reports cost by Agent, provider/model, and work package within
    the active window/status filters and existing retention behavior
  - OpenAPI/generated types, Gateway coverage, CLI `cost-report`, and Studio
    segmented reporting expose the same contract
  - isolated CLI and 1440 x 900 / 390 x 844 browser acceptance verified
    `USD 0.2` effective cost, source switching, internal narrow-table scroll,
    no document overflow, and no console errors
  - implementation details are documented in
    [`docs/30-obs-02-cost-attribution.md`](/C:/project/my-mate/docs/30-obs-02-cost-attribution.md)
- `OC-01A` capacity queue and container hardening landed
  - Docker Worker provisioning now enforces a global concurrency limit and a
    bounded FIFO queue with timeout, queue-limit rejection, and run/node
    cancellation
  - containers receive default CPU, memory, and PID limits plus `--init`,
    dropped capabilities, and `no-new-privileges`; explicit Job limits win
  - Worker readiness requires both Hub registration and a container-internal
    `/health` probe, while the Worker image declares a Docker healthcheck
  - Runtime Summary and Doctor expose active/limit, queue depth/limit, and
    timeout; Studio renders the same posture in Dashboard and Settings
  - provisioner tests cover FIFO drain, cancellation, timeout, queue limit,
    default/explicit resource limits, security flags, and unhealthy cleanup
  - real Docker Doctor, two-node run, 14/14 scorecard, deterministic
    evaluation, complete trace, and exact event replay pass
  - browser acceptance passed at 1440 x 900, 390 x 844, and 360 x 800 with no
    capacity-row overflow, document-level horizontal overflow, or console
    errors
- `OC-01B` crash compensation and recovery hardening landed
  - Worker leases now persist explicit `cleanup_pending`, `cleanup_failed`, and
    successful release evidence with stable attempt identity, timestamps,
    container reference, and the last cleanup error
  - Docker cleanup uses confirmed `rm -f` semantics; missing containers count as
    idempotent success, while daemon failures retain capacity and can be retried
    without duplicating successful cleanup
  - startup reconciliation inventories all containers labeled
    `my-mate.runtime-worker=true` for the current stable `my-mate.manager-id`,
    matches them by container/run/job identity, removes labeled orphans, and
    covers active, terminal, missing-plan, and missing-Run records before the
    server accepts requests without touching another isolated Manager
  - cleanup reconciliation runs before interrupted-node retry; inventory or
    cleanup failure blocks redispatch instead of launching duplicate work
  - `lease.cleanup_started`, `lease.cleanup_completed`, and
    `lease.cleanup_failed` provide idempotent Run audit evidence, while a durable
    reconciliation summary covers orphan containers without a valid Run
  - Runtime Summary, Doctor, Studio Dashboard, and Settings expose pending and
    failed cleanup plus last reconciliation, discovered, orphaned, and removed
    container counts
  - focused tests cover cleanup failure, retry, duplicate release, orphan
    removal, terminal Run cleanup, missing-plan cleanup, redispatch blocking,
    and duplicate recovery audit prevention
  - real Docker restart smoke removed one matched active-lease container and one
    missing-lease orphan, released capacity, and left zero labeled containers
- `SDK-01` generated shared Control Plane contracts landed
  - `openapi-typescript` now generates committed TypeScript path and schema
    types from `openapi/control-plane.openapi.yaml`
  - build and check gates fail on generated-code drift
  - `openapi-fetch` provides a typed client factory with base URL, Bearer auth,
    custom headers, and injectable fetch support
  - OpenAPI supervision contracts now describe changed runtime nodes, gates,
    and handoffs instead of empty object placeholders
  - CLI doctor, supervise, scorecard, evaluation, trace, replay, and replay-plan
    commands consume generated request/response DTOs
  - shared client behavior and all CLI command tests pass
- validated after landing:
  - `npm run check`
  - `npm run build:runtime`
  - `npm test`
  - `npm run runtime-worker:smoke`
  - `npm run runtime-worker:recovery-smoke`
  - `git diff --check`
  - real OpenClaw E2E was not part of this observability validation pass

## Current Working Agreement

The following decisions were agreed as the active working frame for the next
iteration.

### Stage Goal

The current stage goal is:

- move the project from `demoable MVP` toward a `sustainable product shell for
  ongoing integration and iteration`
- do **not** treat production rollout as the primary goal of this stage

### Single Mainline

The single mainline for the just-closed iteration was:

- `SDK-01 Generated Shared Types / SDK`

`SDK-01 Generated Shared Types / SDK` is now closed. Next mainline selection is
pending.

Recently completed support tracks:

- `Mission Workspace Tightening` exit criteria are now satisfied in both Mobile
  and Studio
- `RT-01` runtime steering usability expansion for already-supported live patch
  operations has landed; `RT-02` and `RT-03` have also landed
- `STU-01` graph-canvas information model and minimum skeleton has landed;
  `STU-02` route compare depth and `STU-03` context workflows have also landed

### Mission Workspace Tightening Closure

`Mission Workspace Tightening` is now closed because all of the following are
true:

1. `Mission` becomes the default top-level view in both Mobile and Studio.
2. The center workspace is stably organized around:
   - objective
   - route
   - work packages
   - checkpoints
   - outputs
   - pending decisions
3. The conversation rail remains present, but functions as explanation,
   decision, and audit context rather than the main work surface.
4. Raw planner/run/evidence cards remain available but no longer dominate the
   default reading path.
5. The same Mission workspace structure survives across:
   - draft
   - planned
   - confirmed
   - running
   - waiting_human
   - completed
6. The same contract and product grammar hold in both Mobile and Studio.

### PLAN-02 Closure

`PLAN-02` is now closed because all of the following are true:

1. planner registry synthesis produces materially better agent and skill picks
   than the basic token-aware fallback for common multi-domain intents
2. orchestrator policy defaults continue to shape node-count, review, and
   preferred-profile behavior without hiding stronger domain fits
3. recommendation evidence is specific enough for Mobile and Studio to explain
   why a profile or skill was chosen
4. tests cover the key tie-break and coverage cases for both rule-based and
   local-semantic synthesis

### PLAN-03 Closure

`PLAN-03` is now closed because all of the following are true:

1. registry-synthesized DAGs use dependency-aware structure instead of only
   flat task-to-end edges
2. deterministic local DAG shaping covers common research, execution, content,
   and review flows
3. review policy produces an explicit review gate in the draft DAG
4. tests cover serial, parallel, and review-gated DAG shapes
5. any broader orchestrator or LLM-assisted DAG generation remains behind a
   clear provider boundary and does not replace deterministic fallback safety

### Architecture Boundaries For This Iteration

The current iteration is intentionally bounded as follows:

- continue using the existing `Session / Run` truth plus `MissionSpec`
  projection shape
- do **not** turn this iteration into a separate Mission persistence or
  materializer rewrite
- define a unified `Mission Workspace` contract before continuing UI-specific
  tightening
- the `Control Plane` owns the `Mission Workspace` read model
- Mobile and Studio consume that read model instead of independently deriving
  their own Mission truth

### MW-00 Contract Agreement

`MW-00` is defined as:

- promote the existing `mission_snapshot` into the formal, stable, versioned
  `Mission Workspace` contract
- do **not** treat `MW-00` as a brand-new API invention unless a gap cannot be
  closed by evolving the current contract shape

Versioning rule:

- keep `mission_snapshot` as the top-level contract object for this iteration
- evolve it compatibly instead of inventing a parallel replacement object
- add an explicit contract/schema version marker so frontend consumers can
  distinguish the stabilized contract from older transitional shapes
- allow temporary compatibility fields during migration, but interpret new
  semantics through the versioned contract rather than by guesswork
- every core response that returns primary Mission Workspace truth should carry
  the same explicit workspace-contract version marker, including at least:
  - `GET /api/missions/:sessionId`
  - `GET /api/sessions/:sessionId`

`MW-00` should produce at least these concrete deliverables:

1. a field-level contract definition that distinguishes:
   - required fields
   - optional fields
   - temporary compatibility fields
   - fields that frontends must not replace with locally derived truth
2. a Control Plane-owned contract output covering at least:
   - `objective`
   - `route`
   - `work_packages`
   - `checkpoints`
   - `outputs`
   - `pending_decisions`
   - `execution_summary`
   - `conversation_rail_summary`
   - `evidence_summary`
3. explicit Mobile and Studio consumption rules:
   - UI adapters may remain
   - primary workspace truth must not be recomputed from thread/cards/run graph
4. contract-level tests or verification examples covering:
   - draft
   - planned
   - confirmed
   - running
   - waiting_human
   - completed

The first implementation slice for `MW-00` should be:

1. normalize the formal `Mission Workspace` contract in the `Control Plane`
2. remove primary-workspace semantic recomputation from Mobile
3. follow with Studio consumer cleanup and display-adapter alignment

Rationale:

- the heaviest current semantic fork lives in Mobile
- Studio already behaves more like a consumer wrapper around the backend
  snapshot than a full independent Mission-truth builder
- contract unification is not complete until the strongest local truth rebuild
  path is removed

Suggested engineering split for `MW-00`:

- `MW-00A` Contract definition
- `MW-00B` Control Plane normalization
- `MW-00C` Mobile consumer cleanup
- `MW-00D` Studio consumer cleanup

`MW-00A` should land first as the semantic anchor for the rest of `MW-00`.

Its output should be a field-level contract definition before code-level
consumer cleanup proceeds.

### MW-00A Done Definition

`MW-00A` is only done when all of the following are true:

1. the formal `mission_snapshot` contract field list is defined
2. the `workspace_contract_version` field location and meaning are defined
3. required / optional / compatibility field categories are defined
4. each top-level workspace block has an explicit semantic boundary
5. frontend-forbidden semantic recomputation boundaries are explicitly stated

`MW-00B` is the `Control Plane normalization` step.

Its purpose is to make the Control Plane the single formal construction path
for the primary `mission_snapshot` contract rather than merely adding fields.

### MW-00B Done Definition

`MW-00B` is only done when all of the following are true:

1. the `Control Plane` has a clear and unique formal `mission_snapshot`
   construction path
2. `workspace_contract_version` is emitted by that main construction path
3. `GET /api/missions/:sessionId` and `GET /api/sessions/:sessionId` return
   semantically aligned primary workspace truth
4. the same construction path supports:
   - draft
   - planned
   - confirmed
   - running
   - waiting_human
   - completed
5. contract-level tests cover stage stability and key-field consistency

The frontend rule for `MW-00` is:

- frontends may format and organize display
- frontends may **not** redefine primary Mission workspace semantics

`MW-00` is only done when all of the following are true:

1. `mission_snapshot` is treated as the formal primary workspace contract.
2. The contract covers all core mission stages without requiring frontend
   semantic patching.
3. Mobile and Studio both consume the contract as the main source of workspace
   truth.
4. existing frontend code that derives primary workspace truth independently is
   removed, downgraded, or marked as deprecated transition code.
5. verification proves both frontends are reading the same workspace grammar
   across key mission stages.

### Implementation Boundaries For Current Mainline Tasks

- `MW-01`
  - treat this as an information-architecture and state-structure tightening
    task
  - do **not** treat it as a large visual redesign project
- `MW-02`
  - make outputs, checkpoints, pipelines, and deliverables first-class display
    objects
  - they must be locatable, reviewable, and tied to the current mission stage
  - do **not** expand this iteration into a complete management back office
- `MW-03`
  - keep the conversation rail as explanation / decision / audit context
  - do **not** allow the thread to continue owning primary workspace semantics
- `RT-01`
  - expand natural-language usability for already-supported live patch
    operations
  - do **not** expand this iteration into a broad new runtime primitive
    program
  - keep broader patch-review UX and runtime monitoring in `RT-02` / `RT-03`
- `STU-01`
  - define the graph canvas information model, interaction boundaries, and
    minimum viable skeleton
  - do **not** require this iteration to fully replace the current form-based
    editing flows

### MW-01 Workspace Structure Agreement

The default center-workspace order is:

1. `Objective`
2. `Route`
3. `Work Packages`
4. `Checkpoints`
5. `Outputs`
6. `Pending Decisions`
7. `Execution Summary`
8. `Evidence Summary`

The first five are the stable workspace skeleton and should remain present
across stages, even when a stage-specific empty state is required:

- `Objective`
- `Route`
- `Work Packages`
- `Checkpoints`
- `Outputs`

The remaining three are stage-sensitive emphasis blocks:

- `Pending Decisions`
- `Execution Summary`
- `Evidence Summary`

Rules:

- stable skeleton blocks keep their place even when temporarily empty
- empty skeleton blocks must render stage-aware empty states rather than
  disappearing or showing a generic "no data" state
- `Route` is the normalized summary of the currently selected execution route,
  not the raw planner/revision/proposal history feed
- `Work Packages` are the task-semantic projection of work, not a direct node
  list or runtime frontier dump
- `Checkpoints` represent structural mission gates
- `Pending Decisions` represent the specific human decision currently required
- `Pending Decisions` should only surface decisions that block progress or
  materially change mission direction
- `Execution Summary` should express mission-level execution meaning rather
  than full engine telemetry
- `Evidence Summary` should preserve raw evidence and drilldown paths without
  becoming the primary reading path

### MW-02 Output Surface Agreement

The `Outputs` surface must be organized around deliverable semantics rather
than raw artifact-event semantics.

Default reading order inside `Outputs` should emphasize:

1. current/latest meaningful deliverables
2. stage or work-package association
3. current deliverable status
4. next possible user action
5. historical output trace as a secondary layer

`Outputs`, `Checkpoints`, and `Work Packages` must not read as unrelated
panels. Together they should explain how the current Mission is progressing.

`Outputs` in this iteration should support:

- the current primary/latest deliverable view
- a focused history of key prior outputs
- superseded/finalized/approved status cues where relevant
- drilldown back to related evidence, artifact, run, or stage context
- but **not** a full asset-management or archive system

`Checkpoints` must express at least:

1. structural checkpoint type
2. current checkpoint state
3. the related route, work package, output, run, patch, or decision context

`Work Packages` in this iteration should remain:

- a mission-level first-layer task-semantic breakdown
- capable of showing current structure and progress meaning
- but **not** a deep multi-level task tree

### MW-01 Done Definition

`MW-01` is only done when all of the following are true:

1. Mobile and Studio present the same top-level center-workspace order:
   - `Objective`
   - `Route`
   - `Work Packages`
   - `Checkpoints`
   - `Outputs`
   - `Pending Decisions`
   - `Execution Summary`
   - `Evidence Summary`
2. `Objective`, `Route`, `Work Packages`, `Checkpoints`, and `Outputs` remain
   present across the core mission stages even when they need stage-aware empty
   states.
3. each workspace block respects its agreed semantic boundary instead of
   collapsing back into card/timeline semantics.
4. the same reading skeleton persists across:
   - draft
   - planned
   - confirmed
   - running
   - waiting_human
   - completed
5. thread/raw cards/evidence no longer serve as the default primary reading
   path.

### MW-02 Done Definition

`MW-02` is only done when all of the following are true:

1. `Outputs`, `Checkpoints`, and `Work Packages` are treated as first-class
   center-workspace modules instead of as secondary event/card projections.
2. those three modules collectively explain the current Mission progression
   rather than reading as isolated panels.
3. `Outputs` supports current primary deliverables, focused history, and
   contextual linkage back to stage/work/evidence.
4. `Checkpoints` expresses structural type, current state, and related mission
   context.
5. `Work Packages` presents a mission-semantic first-layer breakdown without
   collapsing into a node list or expanding into a complex task tree.

### MW-03 Conversation And Evidence Agreement

`MW-03` is a product-role correction task, not a visual de-emphasis task.

Its purpose is to move conversation, raw cards, and evidence out of the role of
primary workspace truth while preserving their value.

`conversation rail` must retain these minimum responsibilities:

1. `intent record`
2. `orchestrator explanation`
3. `decision record`
4. `audit trail`

`raw cards` should be preserved with this default strategy:

- collapsed by default
- secondary by default
- expanded only when the user needs drilldown, debugging, or audit detail

`Evidence Summary` and `conversation rail` must remain distinct:

- `conversation rail`
  - human-readable task narrative
  - explains what changed and why
- `Evidence Summary`
  - raw technical evidence and traceability
  - planner/proposal/run/patch/graph/artifact drilldown entry points

### MW-03 Done Definition

`MW-03` is only done when all of the following are true:

1. conversation rail, raw cards, and evidence remain available but no longer
   define the primary Mission workspace semantics.
2. conversation rail is limited to intent, explanation, decision record, and
   audit-trail responsibilities.
3. raw cards are no longer the default primary reading path and are preserved
   through collapsed/secondary/drilldown presentation.
4. `Evidence Summary` preserves raw technical truth and drilldown without
   becoming the main narrative surface.
5. the default user reading path starts from Mission workspace structure and
   progression rather than thread/timeline/card feed.

### Scope Guard

Until `MW-01`, `MW-02`, and `MW-03` satisfy the exit criteria above, the
following items are not allowed to become the primary battlefield for the
iteration:

- `DATA-01`
- `DATA-02`
- `DATA-03`
- `OBS-01`
- `OBS-02`
- `MOB-01`
- `MOB-02`
- `MOB-03`
- `OC-01`
- `OC-02`
- `SDK-01`
- `PLAN-03`

### Mainline Execution Order

The agreed execution order for the current mainline is:

1. `MW-00`
2. `MW-01`
3. `MW-02`
4. `MW-03`

Reasoning:

- `MW-00` must land first so both frontends consume the same Mission Workspace
  truth.
- `MW-01` must land before `MW-02` so the workspace skeleton and reading order
  are stable.
- `MW-02` must land before `MW-03` so the center workspace is strong enough to
  replace thread/card-first reading.
- `MW-03` should only tighten conversation/evidence roles after the Mission
  workspace can carry the primary product meaning on its own.

### Cross-Surface Delivery Rule

For `MW-00` through `MW-03`, the cross-surface rule is:

- semantic contract and workspace grammar must remain aligned between Mobile
  and Studio
- visual/interaction rollout details may land at slightly different times when
  necessary

This means the following must stay aligned across both surfaces:

- the `Mission Workspace` contract
- top-level workspace ordering
- block semantic boundaries
- stage-to-stage workspace grammar
- the completion criteria for `MW-01`, `MW-02`, and `MW-03`

This also means the following may land incrementally:

- visual treatment
- interaction polish
- drilldown-entry refinement
- responsive layout details
- secondary helper views

## Shipped Baseline

### Platform and Core Workflow

- [x] `CORE-01` Control Plane owns Mission / Session / Run truth.
- [x] `CORE-02` Session-native flow supports `message -> draft -> plan -> revise -> confirm -> run`.
- [x] `CORE-03` strict-by-default run validation gate is wired end to end.
- [x] `CORE-04` planner provider registry exists with deterministic fallback behavior.
- [x] `CORE-05` route compare, revision history, and confirmation state are available.
- [x] `CORE-06` registry management exists for agent profiles and skills.

### Runtime Projection and Steering

- [x] `RT-BASE-01` run, node, approval, human-input, artifact, and summary projections flow back into Session / Mission views.
- [x] `RT-BASE-02` runtime interventions are persisted as first-class records.
- [x] `RT-BASE-03` `DagPatchRecord` proposal flow exists.
- [x] `RT-BASE-04` live patch apply currently supports `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and `resume_with_patch`.
- [x] `RT-BASE-05` execution-adapter dispatch recovery and maintenance paths exist.

### Mobile

- [x] `MOB-BASE-01` home, inbox, run list, run follow-up, and task thread screens exist.
- [x] `MOB-BASE-02` create-task/create-run flow works through planner preview and confirmation.
- [x] `MOB-BASE-03` approvals, human input, pause, resume, and cancel actions are available.
- [x] `MOB-BASE-04` mission/thread execution narrative surfaces are implemented.
- [x] `MOB-BASE-05` mobile tests cover planner, schema form, and task-thread projection logic.

### Studio

- [x] `STU-BASE-01` desktop workspace shell exists with missions, sessions, templates, registry, and settings.
- [x] `STU-BASE-02` Mission Workspace and Orchestrator workbench surfaces exist.
- [x] `STU-BASE-03` template, node, edge, lineage, registry, and planner draft editing flows exist.
- [x] `STU-BASE-04` route compare and runtime cockpit surfaces exist.
- [x] `STU-BASE-05` Studio command palette and keyboard navigation foundation exist.

### OpenClaw Integration

- [x] `OC-BASE-01` `api-gateway -> control-plane -> execution-adapter -> openclaw-local` path is implemented.
- [x] `OC-BASE-02` execution-adapter supports `mock`, `native-agent`, and `container-exec` modes.
- [x] `OC-BASE-03` direct-agent async polling and restart recovery exist.
- [x] `OC-BASE-04` proposal-backed run creation and callback projection are implemented.

## Open Tracking Board

| ID | Area | Status | Priority | Task | Notes |
|---|---|---|---|---|---|
| `HR-P0` | HomeRail Alignment | Done | P0 | Establish canonical route/work-package truth and the `doctor -> run -> supervise -> scorecard` Docker operator loop. | All P0 gates in `docs/27-p0-p1-implementation-blueprint.md` pass, including the real two-Worker Docker smoke and `14/14` pipeline scorecard. |
| `HR-P1` | HomeRail Alignment | Done | P1 | Add eval, trace, replay/rerun, provider-native evidence, usage/cost, and graph-first runtime UX. | C1, C2, D1, D2, E1, and E2 pass scoped implementation, test, and visual gates; live provider/model judge checks remain explicit opt-in. |
| `HR-P1-C1` | Policy And Evaluation | Done | P1 | Add declarative policy checks and independent persisted evaluation verdicts. | Offline none/deterministic paths, model queue/recovery, Gateway, CLI, schemas, and tests pass; live Anthropic judge remains explicit opt-in. |
| `HR-P1-C2` | Trace And Replay | Done | P1 | Add first-class trace, pure replay, projection differences, replay-plan, and linked rerun. | Complete V2 runs replay exactly, legacy runs report partial, and rerun uses frozen-plan lineage plus Idempotency-Key. |
| `HR-P1-D1` | Evidence Protocol | Done | P1 | Add streaming Harness Client, Evidence V2 fields, redaction, payload refs, and V1 compatibility. | Synthetic fallbacks are sequenced, schema-validated, redacted, and usage-unavailable. |
| `HR-P1-D2` | Provider Adapters | Done | P1 | Normalize Codex, Claude SDK, Kimi, and OpenClaw native evidence and project usage/cost/tools. | Recorded fixtures and offline tests pass; live provider verification remains explicit opt-in and no unknown model receives estimated cost. |
| `HR-P1-E1` | Runtime Graph UX | Done | P1 | Share deterministic DAG layout and make the spatial runtime graph the primary Studio run view. | Authoring/compare/runtime share one layout; toolbar, cursor refresh, node drawer, URL/keyboard selection, mobile-width list fallback, and six overlap fixtures pass. |
| `HR-P1-E2` | Evaluation UI And Mobile | Done | P1 | Make Studio evaluation actionable and add Mobile topology, evidence, trace, and replay inspection. | Studio actions and verdicts, Mobile staged topology/full-height evidence, four focused tests, and desktop/mobile browser acceptance pass. |
| `MW-00` | Mission Workspace | Done | P0 | Define a unified `Mission Workspace` contract in the Control Plane and align Mobile and Studio to consume it. | Contract definition, Control Plane normalization, Mobile cleanup, Studio cleanup, and cross-stage verification have landed. |
| `MW-01` | Mission Workspace | Done | P0 | Make the center workspace feel persistent rather than mainly card-derived. | Stable 8-module workspace skeleton now lands in Control Plane, Mobile, and Studio. |
| `MW-02` | Mission Workspace | Done | P0 | Promote outputs, checkpoints, pipelines, and generated deliverables into stronger first-class surfaces in both Mobile and Studio. | Structured stage, relation, next-action, and output-history fields now drive Mobile and Studio displays. |
| `MW-03` | Mission Workspace | Done | P0 | Keep raw plan/run/evidence cards secondary while making mission state the main product shell. | Contract-level conversation rail, evidence summary, and raw-card policy now keep conversation/evidence secondary and auditable. |
| `PLAN-01` | Planner / Orchestrator | Done | P1 | Broaden revise-plan understanding beyond the current deterministic structural mutations. | Revise directives now support upfront research/preparation insertion and explicit targeted worker/parallelism updates. |
| `PLAN-02` | Planner / Orchestrator | Done | P1 | Improve agent and skill recommendation quality beyond the current basic registry-aware matching. | Preferred subagent ordering, profile tool inheritance, preferred/domain-fit boundary coverage, profile-scoped skill picking, policy-driven max-node/review defaults, domain-rerank opt-out, multi-domain coverage selection, and Studio/Mobile coverage evidence display have landed. |
| `PLAN-03` | Planner / Orchestrator | Done | P1 | Add stronger DAG synthesis/orchestrator generation behavior beyond flat deterministic fallback planning. | Deterministic domain-aware DAG shaping, explicit review-gate synthesis, and guarded LLM edge rewrites behind provider safety checks have landed. |
| `RT-01` | Runtime Steering | Done | P1 | Expand natural-language runtime steering beyond the current pause/resume/skip/add/change/parallelism mappings. | Multi-operation parsing, natural current/final targets, word-number parallelism, and parse audit metadata now land on existing live operations only. |
| `RT-02` | Runtime Steering | Done | P1 | Improve mobile and Studio patch review ergonomics, including clearer patch history and topology review. | Mobile and Studio now summarize operations, graph impact, topology snapshots, outcomes, and confirmation state for patch review/history. |
| `RT-03` | Runtime Steering | Done | P1 | Add richer monitoring surfaces for runtime progress, checkpoints, and cost-aware intervention. | Runtime graph summaries now expose progress, checkpoint, and capacity/budget posture; Mobile and Studio render those monitoring surfaces. |
| `STU-01` | Studio Authoring | Done | P1 | Define the interactive graph-canvas information model, interaction boundaries, and minimum viable skeleton. | Studio now has a form-backed graph canvas model, deterministic skeleton layout, node/edge selection, invalid-edge visibility, and smoke checks; drag-and-drop replacement remains out of scope. |
| `STU-02` | Studio Authoring | Done | P1 | Add richer route compare/history selectors and a stronger graph diff browser. | Studio now supports explicit revision/option compare selectors, route-history quick picks, side-by-side route graph browsing, and richer diff detail lists on top of the existing compare read model. |
| `STU-03` | Studio Authoring | Done | P1 | Add more desktop-native file/context workflows such as drag-and-drop attach and workspace browsing. | Studio now supports drag/drop and file-picker context references plus a workspace context browser over attachments and generated outputs. |
| `MOB-01` | Mobile Productization | Deferred | P2 | Add push notification flow for approvals, human input, and mission events. | Productization gap; not part of current mainline. |
| `MOB-02` | Mobile Productization | Deferred | P2 | Add account, auth, and permission-layer behavior for real users and workspaces. | Productization gap; not part of current mainline. |
| `MOB-03` | Mobile Productization | Deferred | P2 | Add offline and degraded-network handling for key mobile mission flows. | Productization gap; not part of current mainline. |
| `DATA-01` | Storage | Done | P1 | Move file-backed persistence toward database-backed production storage. | Shared storage backend seam now covers the current store persistence surface, and a sqlite-backed implementation now ships behind the same snapshot migration path. |
| `DATA-02` | Storage / Governance | Done | P1 | Add multi-tenant workspace support, permissions, and audit logs. | Trusted Gateway identity, request-scoped tenant isolation, persistent RBAC, hash-chained audit, OpenAPI/SDK, CLI, Mobile, and Studio workspace flows are implemented and validated. |
| `DATA-03` | Storage / Governance | Done | P2 | Add registry approval workflow and stronger governance controls. | Advisory/enforced workspace policy, independent review, drift-safe apply, audit evidence, OpenAPI/SDK, Gateway, CLI, and Studio workflows are implemented and validated. |
| `OBS-01` | Observability | Done | P1 | Add unified runtime dashboard, tracing, metrics, latency, and failure aggregation. | `OBS-01A/B/C/D` now cover the unified dashboard, runtime metrics/correlation, indexed queries, bounded filters, non-destructive index retention, and previous-period comparison across CP/GW/Studio. |
| `OBS-01B` | Observability | Done | P1 | Add runtime metrics, usage/cost completeness, and Trace/Event/Evaluation correlation with Studio drilldown. | 24-hour activity, reliability, retry, latency, usage/cost, correlation, focused integration coverage, and desktop/mobile visual acceptance pass. |
| `OBS-01C` | Observability | Done | P1 | Replace per-request raw-store scans with per-run indexes and add bounded Dashboard filtering. | Per-run lazy indexes, dirty-write invalidation, 1-720 hour windows, status filters, correlation limits, adaptive buckets, compatibility coverage, Docker smoke, and desktop/mobile acceptance pass. |
| `OBS-01D` | Observability | Done | P1 | Add configurable derived-index retention and previous-period operational comparison. | Default 90-day non-destructive index retention, unlimited override, explicit coverage, seven comparison metrics, Studio toggle/strip, compatibility tests, Docker smoke, and responsive acceptance pass. |
| `OBS-02` | Observability | Done | P2 | Add agent cost tracking and operational reporting surfaces. | Index V2 attribution, provider-preferred effective cost, completeness, Agent/model/work-package reports, OpenAPI/SDK, Gateway, CLI, and Studio are implemented and validated. |
| `OC-01` | OpenClaw Production Hardening | Done | P1 | Add stronger concurrency handling, queueing, container health checks, resource isolation, and crash compensation. | `OC-01A/B` cover bounded capacity, health/isolation, Docker inventory reconciliation, orphan removal, durable cleanup attempts, redispatch gating, and operational visibility. |
| `OC-01A` | OpenClaw Production Hardening | Done | P1 | Add bounded Docker Worker capacity, FIFO provisioning, container health gating, and default isolation. | Unit/integration coverage, real Docker Doctor/runtime smoke, Runtime Summary, Studio Dashboard/Settings, and responsive acceptance pass. |
| `OC-01B` | OpenClaw Production Hardening | Done | P1 | Reconcile Docker Worker resources across crashes and make cleanup durable, observable, and idempotent. | Focused recovery coverage and real Docker restart smoke remove matched/orphan containers, retain failed cleanup capacity, and gate redispatch until compensation succeeds. |
| `OC-02` | OpenClaw Production Hardening | Done | P2 | Add timeout compensation, failure replay, and more complete recovery audit trails. | Persistent deadline compensation, cleanup-gated capacity, restart continuation, frozen failed-Job Replay, evidence/Trace lineage, OpenAPI/Gateway/CLI/Studio operations, and focused plus Docker recovery acceptance are implemented. |
| `SDK-01` | Shared Types / SDK | Done | P1 | Generate shared client types/SDK from schemas and OpenAPI instead of relying on handwritten types. | Committed OpenAPI-generated DTOs, drift checks, typed client factory/tests, strengthened supervision schemas, and CLI consumers have landed. |

## Suggested Near-Term Milestones

### Milestone A: Mission Workspace Tightening

Close these items first:

- [x] `MW-00`
- [x] `MW-01`
- [x] `MW-02`
- [x] `MW-03`

Exit condition:

- Mission becomes the stable product shell in both Mobile and Studio.
- Workspace center reads as a durable work surface, not mainly as a card feed.
- Both frontends consume a shared Mission Workspace contract owned by the
  Control Plane.

### MW-00 Implementation Status

- [x] `MW-00A` first-pass contract definition landed
- [x] `MW-00B` first-pass Control Plane normalization landed
- [x] `MW-00C` Mobile consumer cleanup landed
- [x] `MW-00D` Studio consumer cleanup landed
- [x] `MW-00` final cross-surface stage verification landed

### MW-01 Implementation Status

- [x] Control Plane `mission_snapshot.workspaceSections` emits the stable
      8-module order:
      `objective -> route -> work_packages -> checkpoints -> outputs ->
      pending_decisions -> execution_summary -> evidence_summary`
- [x] Mobile task workspace consumes the same section keys, keeps the stable
      modules visible across workspace stages, and retains local builders only
      as fallback/body adapters.
- [x] Studio Mission Workspace sorts versioned section cards by the same
      8-module order.
- [x] Contract and smoke tests have been updated to guard the MW-01 section
      order.

### MW-02 Implementation Status

- [x] Work packages now expose `stageKey`, `outputKeys`, `checkpointKeys`, and
      `nextActionLabel` so they read as mission work surfaces instead of raw
      node cards.
- [x] Checkpoints now expose `type`, related route/run/output fields, and
      `nextActionLabel` so they show structural gate meaning and related
      context.
- [x] Outputs now expose `stageKey`, `relatedCheckpointKeys`,
      `latestArtifactMessageId`, `currentActionLabel`, and focused `history`
      entries for requested/prepared/runtime/returned progression.
- [x] Mobile and Studio surface the same structured fields inside their center
      workspace modules.
- [x] Control Plane, Mobile, and Studio verification now guard the MW-02
      relation/history fields.

### MW-03 Implementation Status

- [x] `mission_snapshot.conversationRail` now defines the conversation rail as
      intent record, orchestrator explanation, decision record, and audit
      trail.
- [x] `mission_snapshot.evidenceSummary` now defines raw technical evidence as
      collapsed drilldown context rather than the main narrative surface.
- [x] `mission_snapshot.rawCardPolicy` now records secondary-audit role,
      collapsed default state, folded planning revisions, and preserved raw
      card kinds.
- [x] Mobile consumes those fields in the conversation rail, Mission record,
      and Evidence Summary surfaces.
- [x] Studio consumes those fields in Mission Inspector, Workspace Feed, and
      Workspace Support.
- [x] Control Plane, Mobile, and Studio verification now guard MW-03 role and
      collapsed raw-card policy semantics.

### Milestone B: Runtime Steering Maturity

Close these items next:

- [x] `RT-01`
- [x] `RT-02`
- [x] `RT-03`

Exit condition:

- users can steer active work more naturally
- runtime patch review is easier to understand and audit

### RT-01 Implementation Status

- [x] A single runtime intervention can now produce multiple already-supported
      live patch operations, such as `pause_for_replan` + `add_node` +
      `resume_with_patch` or `skip_node` + `resume_with_patch`.
- [x] Natural target language now covers current/active/next/final/last step
      references before falling back to the active run frontier.
- [x] Parallelism parsing now accepts digit and word-number requests such as
      `Use three workers`, while still writing `change_parallelism`.
- [x] `DagPatchRecord.metadata.runtime_steering_parse` and intervention
      metadata now preserve detected cues, operation kinds, target text,
      requested step, requested parallelism, and replacement intent.
- [x] Control Plane tests guard combined pause/add/resume, current-node skip
      plus resume, and word-number parallelism.

### RT-02 Implementation Status

- [x] Mobile now builds a reusable `DagPatchReviewSummary` with operation
      summary, graph impact, topology snapshots, outcome counts, and
      confirmation state.
- [x] Mobile DAG patch cards now show a review summary and before/predicted/
      actual topology snapshots before the confirm/reject controls.
- [x] Mobile execution narrative now uses the same patch review summary so
      patch history reads consistently outside the raw card.
- [x] Studio execution queue now renders per-patch review summaries, operation
      details, outcome details, and topology comparison cards.
- [x] Studio runtime patch history now uses the same richer patch review
      summary and topology comparison instead of only listing operation names.
- [x] Mobile tests and Studio smoke checks guard the new review summary path.

### RT-03 Implementation Status

- [x] Control Plane `RuntimeGraphSummary` now includes `runtimeMonitoring`
      with progress, checkpoint, and capacity/budget posture summaries.
- [x] Runtime graph summary lines now include progress percentage, checkpoint
      state, and capacity/budget context for monitoring surfaces.
- [x] Mobile execution summary renders progress, checkpoint, and cost/capacity
      monitoring cards above the runtime topology.
- [x] Studio Runtime Graph renders the same monitoring cards for desktop review.
- [x] The runtime graph cost-aware surface remains a capacity/budget posture;
      actual provider/estimated spend accounting is now supplied separately by
      the completed `OBS-02` Dashboard report.
- [x] Control Plane, Mobile, and Studio verification guard the new monitoring
      summary path.

### Milestone C: Studio Graph Workbench

Then close:

- [x] `STU-01`
- [x] `STU-02`
- [x] `STU-03`

Exit condition:

- Studio is no longer primarily a form editor for DAG work
- graph authoring and comparison are first-class desktop workflows

### STU-01 Implementation Status

- [x] Studio DAG authoring now builds a graph-canvas information model from
      `state.editor.nodes` and `state.editor.edges`.
- [x] The canvas skeleton uses deterministic DAG-depth columns and stable card
      dimensions so the graph can be scanned before editing the forms.
- [x] Node cards expose ID, name, type, agent, skill count, approval, output,
      parallelism, and timeout markers from the existing editor state.
- [x] Edge rendering exposes valid links, invalid endpoints, labels, and
      source/target summaries without changing the persisted template payload.
- [x] Selecting a graph node or edge highlights and scrolls to the existing
      form-backed editor row, keeping the current forms as the write path.
- [x] Studio smoke checks guard the graph model, canvas renderer, selection
      actions, and canvas styles.
- [x] Drag-and-drop node placement, direct canvas editing, and replacing the
      form editor remain out of scope for `STU-01`.

### STU-02 Implementation Status

- [x] Studio route compare now supports explicit left/right revision and option
      selectors instead of only the default compare snapshot.
- [x] Recent route history is available as quick-pick chips so operators can
      swap compare endpoints without message archaeology.
- [x] Route compare renders side-by-side graph browsers for the selected left
      and right route endpoints using the existing plan-option candidate plans.
- [x] Node and edge diff states are surfaced visually in the graph browser and
      structurally in the detailed changed nodes/edges/gates/outputs/risks
      lists.
- [x] Refreshing compare selections reuses the existing
      `/api/sessions/:sessionId/compare` selectors rather than introducing a
      new backend contract.
- [x] Studio smoke checks now guard the richer compare diff browser, compare
      refresh action, history picker, and compare browser styles.

### PLAN-01 Implementation Status

- [x] Revise-plan directives now detect research, discovery, preparation,
      requirements, and context-gathering requests.
- [x] The Control Plane can insert a `Revision Preparation` step before the
      current route frontier or before a targeted executable step.
- [x] Explicit worker and parallelism instructions now set node-level
      parallelism and raise the route `max_parallel_nodes` policy as needed.
- [x] Control Plane tests guard preparation-step insertion and targeted
      parallelism updates.

### PLAN-02 Implementation Status

- [x] Orchestrator profile defaults now shape preferred subagent order,
      max-node policy, domain-rerank behavior, and review requirement handling.
- [x] Local-semantic registry synthesis now scores profile domain overlap,
      token fit, default-skill fit, readiness, and disallowed-skill penalties.
- [x] Multi-domain intents now spread selected profiles across uncovered
      domains before filling remaining slots.
- [x] Borrowed skills are scoped to the selected profile's matched domains so
      multi-domain drafts keep review, research, and content skills on the
      right nodes.
- [x] Mobile and Studio now surface coverage evidence for planner
      recommendations.
- [x] Control Plane tests guard preferred-profile boundaries, policy defaults,
      rerank opt-out, multi-domain coverage, token/readiness tie-breaks,
      disallowed penalties, and profile-scoped skill picking.

### PLAN-03 Implementation Status

- [x] Local-semantic registry synthesis now builds domain-aware DAG edges rather
      than connecting every selected agent task directly to `node_end`.
- [x] Research/customer context stages feed execution/content stages, while
      review-domain stages are placed after upstream work.
- [x] Peer execution domains can remain parallel when they share the same DAG
      phase.
- [x] `require_review` adds an explicit `node_review_gate` approval node to
      local-semantic registry-synthesized drafts.
- [x] Control Plane tests guard research-to-content ordering, peer-domain
      parallelism, review-domain ordering, and review-gate generation.
- [x] `llm_claude_v1` can shape registry-synthesized DAG edges only through a
      constrained `shape_dag` tool call over existing node ids.
- [x] LLM edge output is locally checked for unknown nodes, self-loops, cycles,
      path-to-end reachability, review-gate preservation, and template
      validation before it is accepted.
- [x] Unsafe LLM edge output falls back to the deterministic local-semantic DAG
      and records the fallback reason in draft metadata/context.
- [x] Control Plane tests guard accepted LLM edge rewrites and unsafe-edge
      deterministic fallback.

### DATA-01 Implementation Status

- [x] Control Plane now exposes a shared JSON storage backend abstraction for
      persistence reads/writes.
- [x] `session-store`, `run-store`, and `run-plan-store` now consume that
      shared backend seam instead of direct file IO for their primary reads.
- [x] `node-run-store`, `event-store`, `template-store`, and `registry-store`
      now consume that shared backend seam for primary list/get/read paths.
- [x] Approval, human input, orchestrator profile, session message,
      session intervention, session attachment, artifact, DAG patch, and DAG
      proposal stores now use the same backend seam for primary read/list/get
      paths.
- [x] Control Plane tests now prove backend replacement against a non-file JSON
      storage implementation.
- [x] Storage backend selection now fails fast for unsupported database backend
      kinds instead of silently using file storage.
- [x] Storage snapshot export/import provides a concrete migration path for
      moving existing file-json records into the sqlite backend.
- [x] Direct JSON file reads in `services/control-plane/src` are now limited to
      the schema loader and the default file-backed storage backend itself.
- [x] A database-backed sqlite backend is now available behind the shared
      storage abstraction.

### DATA-02 Implementation Status

- [x] `DATA-02A/B` shared principal, membership, role, permission, workspace,
      and audit contracts are exported from `@my-mate/shared-types/identity`.
- [x] API Gateway resolves configured bearer identities, rejects foreign
      workspace selection, and signs internal context with HMAC-SHA256.
- [x] Control Plane verifies signature and issue time, reconciles persistent
      membership, and recalculates permissions from the stored role.
- [x] `DATA-02C` request-scoped tenant context filters Session, Run, Template,
      Registry, Orchestrator, Gate, Artifact, Message, Attachment, and runtime
      persistence surfaces.
- [x] Cross-workspace resource access returns `404`; trusted identity owns new
      actor and workspace fields; background runtime recovery remains global.
- [x] Legacy records without workspace ownership migrate idempotently to
      `default` during application startup.
- [x] `DATA-02D/E` route permissions cover workspace, registry, mission, run,
      evaluation, gate, and audit operations.
- [x] Persistent membership APIs enforce the last-active-owner invariant.
- [x] Allowed, denied, authentication, authorization, and error outcomes are
      recorded in normalized per-workspace SHA-256 audit chains.
- [x] OpenAPI and generated SDK expose identity/workspace/member/audit schemas
      and selected-workspace request configuration.
- [x] `DATA-02F` CLI supports `--workspace`, `MY_MATE_WORKSPACE_ID`,
      `workspace_id`, `whoami`, `workspaces`, and `audit`.
- [x] Mobile exposes bearer/workspace headers and an Account tab for identity,
      workspace switching, members, roles, and audit verification.
- [x] Studio Settings manages bearer/workspace state and reloads all scoped
      projections after token refresh or workspace switch without stale errors.
- [x] Control Plane full tests, repository check/test/build, CLI Gateway E2E,
      and desktop/mobile Studio browser acceptance pass.

### DATA-03 Implementation Status

- [x] Workspace governance policy defaults to `advisory`, supports `enforced`,
      validates 1-5 approvals, and freezes policy values into each proposal.
- [x] Protected actions cover Agent Profile and Skill upsert/disable plus
      Template publish/archive without changing unprotected mutation behavior.
- [x] `governance.review` is granted to owner/admin only; proposals require
      `registry.manage`, self-approval is denied by default, and duplicate
      decisions are rejected.
- [x] Change records persist canonical payload and baseline SHA-256 digests,
      proposer/reviewer/apply evidence, result metadata, and conflict reason.
- [x] Approved changes recheck the resource baseline before apply and become
      `conflicted` when concurrent Registry or Template state has changed.
- [x] Governance records remain workspace scoped; cross-workspace reads return
      `404`, and governance events participate in the verified DATA-02 audit
      chain.
- [x] OpenAPI, generated shared types, Gateway allowlist, and CLI support cover
      policy, list, propose, approve, reject, and apply operations.
- [x] Studio Registry stages protected actions, exposes the policy/proposal/
      approval workbench, disables proposer self-review, and refreshes affected
      projections after apply.
- [x] Focused Control Plane, Gateway, CLI, and Studio checks plus isolated
      owner/admin browser acceptance cover the governance lifecycle and
      desktop/mobile overflow behavior.

### STU-03 Implementation Status

- [x] Studio Context Files now has a desktop drop zone for local file reference
      intake.
- [x] Studio Context Files now supports multi-file picker intake using the same
      session attachment metadata API.
- [x] Studio Workspace Browser lists mission context files and generated output
      artifacts in one scannable surface.
- [x] Generated output artifacts can be attached back as mission context
      references when they expose a reusable storage URI.
- [x] Studio smoke checks guard the drag/drop, file picker, workspace browser,
      and context-reference action markers.

### OBS-01 Implementation Status

- [x] Control Plane `GET /health` now exposes runtime storage backend kind and
      execution adapter kind.
- [x] Control Plane `GET /api/dashboard/summary` now aggregates runtime health,
      workload counts, intervention backlogs, and recent waiting/failure
      hotspots.
- [x] Dashboard summary attention tone now distinguishes danger
      (recent failures) from warn-only backlog states.
- [x] Control Plane tests guard dashboard summary backlog aggregation and
      deterministic hotspot ordering.
- [x] API Gateway now exposes `GET /api/dashboard/summary` through the existing
      allowlisted proxy surface.
- [x] Studio now has a `Dashboard` mode that consumes the unified summary
      response for runtime posture, backlog, and hotspot inspection.
- [x] `OBS-01B` adds 24 hourly activity buckets, run/job reliability and
      latency, retry rate, usage completeness, token totals, and separated
      provider/estimated cost totals.
- [x] `OBS-01B` correlates recent runs with trace IDs, ordered events,
      jobs/retries, Evidence V2, scorecards, evaluations, findings, usage, and
      cost.
- [x] Studio renders Runtime Performance, 24 Hour Activity, and a horizontally
      contained Trace / Event / Evaluation Correlation table with session/run
      graph drilldown.
- [x] Control Plane tests and 1440 x 900, 390 x 844, and 360 x 800 browser
      acceptance cover correlation accuracy, text fit, internal table scroll,
      and document overflow.
- [x] `OBS-01C` moves Dashboard metrics and correlation aggregation to one
      lazily rebuilt observability index per run with source-write dirty
      invalidation and file-json/SQLite storage support.
- [x] `OBS-01C` adds bounded time-window, run-status, and correlation-limit
      filters, adaptive 60m/360m/1440m activity buckets, Gateway/OpenAPI
      forwarding, and Studio 24h/7d/30d controls without breaking legacy
      requests.
- [x] `OBS-01D` adds configurable derived-index retention, preserves canonical
      runtime/evidence data and legacy all-history requests, and exposes
      explicit cleanup/coverage metadata.
- [x] `OBS-01D` adds previous-period comparison metrics and a Studio toggle /
      comparison strip without changing the additive Dashboard response
      contract.

### OBS-02 Implementation Status

- [x] Observability index schema V2 records Agent Profile, provider/model,
      runtime, Node, and work-package attribution without changing canonical
      runtime or Evidence stores.
- [x] Effective cost prefers provider-reported cost, falls back to catalog
      estimate, never double counts both, and aggregates decimal strings per
      currency without FX conversion.
- [x] Report coverage distinguishes provider, estimated-only, costed, and
      unavailable model Jobs with complete/partial/unavailable verdicts.
- [x] Dashboard cost groups cover Agent, provider/model, and work package plus
      tokens, failed Jobs, retries, Run count, source, and completeness.
- [x] OpenAPI/generated types, Gateway pass-through coverage, and CLI
      `cost-report` expose the indexed report with window/status filters.
- [x] Studio renders a compact segmented Cost Attribution panel with internal
      table scrolling only where the available workspace width requires it.
- [x] Focused backend/Gateway/CLI checks and isolated desktop/mobile browser
      acceptance validate provider preference, estimate fallback, unavailable
      evidence, grouping, layout, and clean console output.

### Milestone D: Production Foundations

Track in parallel when product shell risk is lower:

- [x] `DATA-01`
- [x] `DATA-02`
- [x] `DATA-03`
- [x] `OBS-01`
- [x] `OBS-02`
- [x] `OC-01`
- [x] `OC-01A` global Docker Worker capacity, FIFO queue timeout/cancellation,
      container health gating, default resource/security isolation, and
      Runtime Summary/Doctor/Studio observability.
- [x] `OC-01B` durable cleanup attempts, Docker inventory reconciliation,
      orphan removal, crash-safe capacity restoration, recovery audit events,
      redispatch gating, and Runtime Summary/Doctor/Studio recovery posture.
- [x] `OC-02` persistent timeout compensation, cleanup-gated retries,
      frozen-identity failed-node Replay, recovery evidence/Trace, API/CLI/Studio
      operations, restart continuation, and acceptance coverage.
- [x] `SDK-01` generated OpenAPI DTOs, drift enforcement, typed HTTP client,
      client behavior test, and CLI contract migration.

Exit condition:

- the system is no longer limited to local/demo-style persistence and operations

## Review Rhythm

Suggested maintenance rhythm:

- weekly: update `Status`, `Priority`, and `Notes`
- at milestone close: move completed work into `Shipped Baseline`
- at every major demo: refresh the validation commands in `Snapshot`
