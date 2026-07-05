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

- `2026-07-05`

Current validated local checks:

- `apps/mobile`: `npm run check`, `npm test`
- `apps/studio`: `npm run check`
- `services/api-gateway`: `npm run check`, `npm test`
- `services/execution-adapter`: `npm run check`, `npm test`
- `services/control-plane`: `npm run check`, `npm test`

Current read of the repository:

- core MVP orchestration loop exists
- Mission / Session / Run projections exist
- mobile and Studio surfaces are usable today
- OpenClaw bridge path is implemented and locally verified
- main remaining work is product shell maturity, graph authoring, runtime
  steering depth, and productionization

Latest implementation update:

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
- validated after landing:
  - `cd services/control-plane && npm run check`
  - `cd services/control-plane && npm test`
  - `cd apps/mobile && npm run check`
  - `cd apps/mobile && npm test`
  - `cd apps/studio && npm run check`

## Current Working Agreement

The following decisions were agreed as the active working frame for the next
iteration.

### Stage Goal

The current stage goal is:

- move the project from `demoable MVP` toward a `sustainable product shell for
  ongoing integration and iteration`
- do **not** treat production rollout as the primary goal of this stage

### Single Mainline

The single mainline for the next iteration is:

- `Mission Workspace Tightening`

Support tracks may move in service of that mainline, but they do not replace
it:

- `RT-01` runtime steering usability expansion for already-supported live patch
  operations
- `STU-01` graph-canvas information model and minimum skeleton planning

### Exit Criteria For Mission Workspace Tightening

`Mission Workspace Tightening` is only considered complete when all of the
following are true:

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
| `MW-00` | Mission Workspace | Done | P0 | Define a unified `Mission Workspace` contract in the Control Plane and align Mobile and Studio to consume it. | Contract definition, Control Plane normalization, Mobile cleanup, Studio cleanup, and cross-stage verification have landed. |
| `MW-01` | Mission Workspace | Active | P0 | Make the center workspace feel persistent rather than mainly card-derived. | Current gap called out in [`docs/08-current-status-and-next-steps.md`](/C:/project/my-mate/docs/08-current-status-and-next-steps.md). |
| `MW-02` | Mission Workspace | Active | P0 | Promote outputs, checkpoints, pipelines, and generated deliverables into stronger first-class surfaces in both Mobile and Studio. | This iteration targets first-class visibility, reviewability, and stage linkage, not a full management back office. |
| `MW-03` | Mission Workspace | Active | P0 | Keep raw plan/run/evidence cards secondary while making mission state the main product shell. | Conversation remains explanation / decision / audit context rather than the main work surface. |
| `PLAN-01` | Planner / Orchestrator | Active | P1 | Broaden revise-plan understanding beyond the current deterministic structural mutations. | Current revise flow is intentionally narrow and rule-based. |
| `PLAN-02` | Planner / Orchestrator | Planned | P1 | Improve agent and skill recommendation quality beyond the current basic registry-aware matching. | Follow-up after Mission shell tightening. |
| `PLAN-03` | Planner / Orchestrator | Deferred | P2 | Add stronger DAG synthesis/orchestrator generation behavior beyond deterministic fallback planning. | Explicitly out of scope until Mission Workspace tightening exits. |
| `RT-01` | Runtime Steering | Support Track | P1 | Expand natural-language runtime steering beyond the current pause/resume/skip/add/change/parallelism mappings. | Limit this iteration to already-supported live operations and better usability/auditability. |
| `RT-02` | Runtime Steering | Planned | P1 | Improve mobile and Studio patch review ergonomics, including clearer patch history and topology review. | Supported operations already apply live. |
| `RT-03` | Runtime Steering | Planned | P1 | Add richer monitoring surfaces for runtime progress, checkpoints, and cost-aware intervention. | Product gap, not engine absence. |
| `STU-01` | Studio Authoring | Support Track | P1 | Define the interactive graph-canvas information model, interaction boundaries, and minimum viable skeleton. | Do not require this iteration to fully replace the form-based authoring path. |
| `STU-02` | Studio Authoring | Planned | P1 | Add richer route compare/history selectors and a stronger graph diff browser. | Compare read model exists today. |
| `STU-03` | Studio Authoring | Planned | P1 | Add more desktop-native file/context workflows such as drag-and-drop attach and workspace browsing. | Attachment model exists, native ergonomics do not. |
| `MOB-01` | Mobile Productization | Deferred | P2 | Add push notification flow for approvals, human input, and mission events. | Productization gap; not part of current mainline. |
| `MOB-02` | Mobile Productization | Deferred | P2 | Add account, auth, and permission-layer behavior for real users and workspaces. | Productization gap; not part of current mainline. |
| `MOB-03` | Mobile Productization | Deferred | P2 | Add offline and degraded-network handling for key mobile mission flows. | Productization gap; not part of current mainline. |
| `DATA-01` | Storage | Deferred | P1 | Move file-backed persistence toward database-backed production storage. | Important, but explicitly not the current battlefield before Mission Workspace exit criteria are met. |
| `DATA-02` | Storage / Governance | Deferred | P1 | Add multi-tenant workspace support, permissions, and audit logs. | Foundation missing for production rollout; not part of current mainline. |
| `DATA-03` | Storage / Governance | Deferred | P2 | Add registry approval workflow and stronger governance controls. | After core tenancy/auth work; not part of current mainline. |
| `OBS-01` | Observability | Deferred | P1 | Add unified runtime dashboard, tracing, metrics, latency, and failure aggregation. | Docs still list observability as not implemented; not part of current mainline. |
| `OBS-02` | Observability | Deferred | P2 | Add agent cost tracking and operational reporting surfaces. | Useful after core metrics exist; not part of current mainline. |
| `OC-01` | OpenClaw Production Hardening | Deferred | P1 | Add stronger concurrency handling, queueing, container health checks, and resource isolation. | Bridge path is verified; production hardening is not part of current mainline. |
| `OC-02` | OpenClaw Production Hardening | Deferred | P2 | Add timeout compensation, failure replay, and more complete recovery audit trails. | Recovery exists, but production replay is still missing; not part of current mainline. |
| `SDK-01` | Shared Types / SDK | Deferred | P1 | Generate shared client types/SDK from schemas and OpenAPI instead of relying on handwritten types. | Schemas exist; generated SDK does not; not part of current mainline. |

## Suggested Near-Term Milestones

### Milestone A: Mission Workspace Tightening

Close these items first:

- [x] `MW-00`
- [ ] `MW-01`
- [ ] `MW-02`
- [ ] `MW-03`

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

### Milestone B: Runtime Steering Maturity

Close these items next:

- [ ] `RT-01`
- [ ] `RT-02`
- [ ] `RT-03`

Exit condition:

- users can steer active work more naturally
- runtime patch review is easier to understand and audit

### Milestone C: Studio Graph Workbench

Then close:

- [ ] `STU-01`
- [ ] `STU-02`
- [ ] `STU-03`

Exit condition:

- Studio is no longer primarily a form editor for DAG work
- graph authoring and comparison are first-class desktop workflows

### Milestone D: Production Foundations

Track in parallel when product shell risk is lower:

- [ ] `DATA-01`
- [ ] `DATA-02`
- [ ] `OBS-01`
- [ ] `OC-01`
- [ ] `SDK-01`

Exit condition:

- the system is no longer limited to local/demo-style persistence and operations

## Review Rhythm

Suggested maintenance rhythm:

- weekly: update `Status`, `Priority`, and `Notes`
- at milestone close: move completed work into `Shipped Baseline`
- at every major demo: refresh the validation commands in `Snapshot`
