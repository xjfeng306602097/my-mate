# My Mate Current Status And Next Steps

This document records what is already implemented in the repository today, what has been verified locally, and what still remains on the roadmap.

## Overview

The repository is no longer only a design skeleton.

It already includes:

- design and schema documents
- API gateway and control-plane MVPs
- planner-backed template selection and candidate run preview
- strict-by-default run creation validation
- a mobile shell for create / inbox / run follow-up flows
- a session-first mobile task thread MVP
- a local Studio MVP for template and DAG editing
- an execution adapter path for local OpenClaw integration

It also now has enough implemented behavior to support a product-direction
correction:

- the current Session loop remains a valid foundation
- but the next shell should become Mission/workspace/spec-first rather than
  remaining thread-first

## Completed

### P0 run creation validation gate

- [x] Planner warning flow is connected to real run creation.
- [x] `POST /api/runs` defaults to `validation_mode: "strict"` when omitted.
- [x] Invalid requests are blocked with `run_validation_failed`.
- [x] Client-side warn override is still supported, but only after explicit human confirmation.
- [x] Planner preview, registry readiness, and real run creation are now aligned end to end.

### Planner and authoring MVP

- [x] Intent-to-template selection endpoint is available through the API gateway.
- [x] Candidate run preview endpoint is available through the API gateway.
- [x] Planner is a pluggable `PlannerProvider` registry: `rule_based_v1` (deterministic fallback), `local_semantic_v1` (domain dictionary rerank, EN+ZH), `llm_claude_v1` (Anthropic tool-use template selection). Active provider is selected by `MY_MATE_PLANNER_PROVIDER`; non-template errors transparently fall back and annotate `planner_context.provider_id`, `fallback_used`, `fallback_reason`.
- [x] Studio can edit published templates and DAG data in form-based mode.
- [x] Studio can copy or save preview output as a draft workflow.

### Mobile shell MVP

- [x] Home overview screen exists.
- [x] Inbox screen exists for approvals and human input requests.
- [x] Run list and run follow-up screens exist.
- [x] Create-run flow exists for published templates.
- [x] Session-first task thread tab exists.
- [x] Session list and session detail thread screens exist.
- [x] Session creation with initial natural-language task message exists.
- [x] Session message append flow exists.
- [x] Session plan flow exists and writes planner output back into the thread.
- [x] Session can create a linked run from the thread.
- [x] Template search by name, description, and domain exists.
- [x] Schema-driven input form exists with enum, boolean, number, integer, and multiline support.
- [x] Mobile actions exist for approve, reject, submit human input, pause, resume, and cancel.
- [x] Strict-by-default run creation and explicit warn override are wired in the mobile flow.

### Conversation-first Phase 1 foundation

- [x] `SessionRecord` and `SessionMessageRecord` types exist in control-plane.
- [x] File-backed session and session-message stores exist.
- [x] Control-plane APIs exist for:
  - `POST /api/sessions`
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionId`
  - `GET /api/sessions/:sessionId/messages`
  - `POST /api/sessions/:sessionId/messages`
  - `POST /api/sessions/:sessionId/plan`
  - `POST /api/sessions/:sessionId/runs`
- [x] API gateway allowlist exposes the session APIs.
- [x] Existing planner output is projected into session messages as `text` and `plan_card`.
- [x] Real run creation from a session is linked back into the thread as `run_card`.
- [x] `create run` persistence logic is now shared between direct `/api/runs` and `/api/sessions/:sessionId/runs`.
- [x] Control-plane and gateway tests cover the new session flow.

### Conversation-first Phase 2 first slice

- [x] Session detail and message APIs now return dynamic execution projection messages.
- [x] Linked run state is projected back into the session thread as `summary_card`.
- [x] Active node execution state is projected back into the session thread as `subtask_card`.
- [x] Pending approvals are projected into the session thread as `approval_card`.
- [x] Pending human-input requests are projected into the session thread as `human_input_card`.
- [x] Artifacts are projected into the session thread as `artifact_card`.
- [x] Mobile task thread screen can render the projected execution cards.
- [x] Mobile task thread can approve / reject inline from the session thread.
- [x] Mobile task thread can submit human input inline from the session thread.
- [x] Session thread has an explicit `Replan` action and plan revision history.
- [x] Session thread now shows visible plan revision diff summaries.
- [x] Session supports confirming a specific plan revision for execution.
- [x] Session run creation can now target a specific plan revision instead of always using only the latest plan.
- [x] Session plan cards now expose alternative template candidates for thread-side replanning.
- [x] Session thread now supports a basic natural-language `Revise plan` loop.
- [x] Basic revise directives can now deterministically mutate plan structure for selected intent patterns.
- [x] Revise directives now cover targeted approval on a specific step and a parallel-then-review shape.

### P1 product loop closure

- [x] `Tasks` and session thread are now the primary orchestration entry.
- [x] `Create` page remains as a compatibility shell and now routes into a task thread instead of directly creating a run.
- [x] Session thread now supports `POST /api/sessions/:sessionId/dag-draft`.
- [x] Session thread can render `draft_card` and convert a selected draft into a planned revision.
- [x] Session planning now produces `plan_options_card` with two full plan options when there are at least two template candidates.
- [x] Session confirmation now stores both `confirmed_plan_revision` and `confirmed_plan_option`.
- [x] Session run creation can now execute the confirmed option, or an explicitly selected option, instead of only a revision number.
- [x] Session revise now accepts a source option and records `source_revision` and `source_option` in-thread.
- [x] Mobile task thread now renders guided confirmation checklist data per plan option.
- [x] API gateway now proxies session DAG draft and option-aware confirm/revise/run payloads.
- [x] Mobile task thread now separates user/orchestrator text turns from raw draft/plan/run cards.
- [x] Thread view now keeps `draft_card`, `plan_options_card`, `run_card`, approvals, and artifacts as collapsible evidence instead of the main conversation.
- [x] Orchestrator confirm/run status echoes remain visible as conversation replies while raw card evidence stays folded by default.
- [x] Wide / landscape task thread now uses a three-zone orchestrator workspace: process map, central generated work surface, and right-side conversation record.
- [x] The central work surface now includes process snapshots for briefing, work packages, plan, run state, and audit trail.
- [x] Wide mode now keeps audit evidence visible as a first-class panel with expandable raw evidence cards.

### P1.5 conversation-native orchestration loop

- [x] `POST /api/sessions/:sessionId/messages` now behaves as `message -> orchestrator interpretation`, not only append + ack.
- [x] Session working state now persists beyond `current_goal`, including `working_goal`, `constraints_summary`, `open_questions`, `pending_decision`, `latest_orchestrator_intent`, and `workspace_state`.
- [x] Ordinary user messages now emit structured orchestrator artifacts:
  - `orchestrator_turn`
  - `goal_update_card`
  - `decision_card`
  - `workspace_snapshot_card`
- [x] Ordinary user messages can now update the workspace even when no new run is launched.
- [x] Explicit message intents now auto-route into deterministic draft / plan / revise / confirm / run actions when the intent is unambiguous.
- [x] Route-stale handling now blocks confirm when the brief changes after a plan exists.
- [x] Message-driven confirm now stores a locked execution source when the target route is unambiguous.
- [x] Message-driven run now reports strict validation failures back into the conversation instead of failing silently.
- [x] Message-driven transition failures now update session state coherently, including `pending_decision`, `last_orchestrator_message_id`, and refreshed `workspace_state`.
- [x] Control-plane tests now cover both successful and blocked message-driven orchestration transitions.

### P2 runtime intervention first slice

- [x] `POST /api/sessions/:sessionId/interventions` now exists in control-plane.
- [x] Runtime user input is now recorded as a first-class `SessionInterventionRecord` instead of being treated as ordinary chat or accidental plan revision.
- [x] Intervention records are projected back into the Session thread as `intervention_card` messages.
- [x] Session workspace state now exposes `pending_intervention_count`, `latest_intervention_id`, `latest_intervention_kind`, `latest_intervention_status`, and `latest_intervention_summary`.
- [x] API gateway proxies session intervention requests.
- [x] Mobile runtime composer now uses `createSessionIntervention` while a session is `running` or `waiting_human`.
- [x] Mobile runtime composer now also treats active `latest_run` states (`queued`, `running`, `waiting_human`, `paused`, `blocked`) as intervention capture mode, so a paused run does not fall back to ordinary chat.
- [x] Mobile workspace and execution narrative surface recorded runtime interventions.
- [x] Tests cover control-plane intervention recording/projection, gateway passthrough, and mobile runtime intervention narrative.
- [x] Browser smoke verified a paused run records a Chinese runtime intervention as `intervention_card` and does not create an extra plan revision.
- [x] Runtime interventions now generate a structured `DagPatchRecord` proposal.
- [x] Patch proposals are projected into the session thread as `dag_patch_card`.
- [x] Mobile renders `dag_patch_card` separately from the raw intervention record and shows proposed operations.
- [x] `patch_preview.supported` now means "a structured patch proposal was generated".
- [x] `DagPatchRecord.apply_supported` is now per-operation and covers live apply for `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and `resume_with_patch`.
- [x] `POST /api/sessions/:sessionId/patches/:patchId/confirm` and `.../reject` endpoints exist.
- [x] Confirming a patch dispatches `pause_for_replan` / `skip_node` through existing control-plane primitives and notifies the execution adapter; partial application surfaces as `applied_with_errors`.
- [x] Mobile `dag_patch_card` now exposes Confirm / Reject buttons when the patch is apply-ready.
- [x] `pause_for_replan` and `skip_node` live application is wired end-to-end through `applyRunAction` / `applyNodeAction`, including adapter notification and `applied_with_errors` partial outcomes.
- [x] `add_node` live application inserts a compiled runtime step, rewires delivery edges, refreshes ready node runs, and preserves resumed topology on the patch record.
- [x] `change_parallelism` live application mutates `policy_snapshot.max_parallel_nodes`, refreshes the scheduler frontier, and can dispatch newly available ready nodes.
- [x] `resume_with_patch` resumes paused runs or refreshes active runs after a patch, then records topology before and after the scheduler pass.
- [x] Natural-language runtime steering now deterministically maps common pause / resume / skip / add-step / change / parallelism requests, including named-node skip targeting, add-step label extraction, explicit numeric parallelism such as `Set concurrency to 2`, and structured replacement intent such as `Replace Backend Task with QA pass`.
- [ ] Natural-language to dynamic op mapping beyond the current deterministic pause / resume / skip / add-step / change / parallelism rules is still pending.

### Android and local mobile verification

- [x] Android emulator launch has been verified locally.
- [x] The mobile app has been built, installed, and launched in the emulator.
- [x] The foreground Android activity was verified as `com.anonymous.mymatemobile/.MainActivity`.
- [x] Local gateway access for the emulator path was verified through `10.0.2.2`.
- [x] Missing Expo native dependency issues were fixed by adding `expo-linking`.
- [x] Deprecated `expo-router/babel` plugin usage was removed from the mobile Babel config.

### Mobile testability and automated tests

- [x] Planner logic was extracted into [`apps/mobile/lib/planner.ts`](/C:/project/my-mate/apps/mobile/lib/planner.ts).
- [x] Schema form logic was extracted into [`apps/mobile/lib/schema.ts`](/C:/project/my-mate/apps/mobile/lib/schema.ts).
- [x] Create screen was refactored to use the shared planner helpers.
- [x] Schema form was refactored to use shared schema helpers and types.
- [x] Automated tests were added for planner logic and schema payload validation.
- [x] `apps/mobile` now has a local `npm test` script.
- [x] `cd apps/mobile && npm run check` passes.
- [x] `cd apps/mobile && npm test` passes.

### Local integration status

- [x] API gateway local entry point exists at `http://127.0.0.1:4030`.
- [x] Control plane local health endpoint exists at `http://127.0.0.1:4010/health`.
- [x] Studio local dev entry point exists at `http://127.0.0.1:5174`.
- [x] OpenClaw local Docker bridge path has been validated previously.

## Runnable Today

The following flows are available in the current repository state:

1. Start the API gateway from `services/api-gateway`.
2. Start the Studio from `apps/studio`.
3. Start Metro from `apps/mobile`.
4. Use the mobile app to:
   - create a task thread
   - send natural-language task messages
   - trigger planner output inside the thread
   - compare plan revisions inside the thread
   - confirm a specific plan revision
   - create a real run from a confirmed or explicitly selected plan revision
   - browse home and inbox
   - select a template
   - preview a candidate plan
   - create a run with strict validation by default
   - explicitly retry with warn override after confirmation
   - handle approval / input / pause / resume / cancel actions

## Local Workarounds And Notes

- `apps/mobile/.npmrc` currently uses `strict-ssl=false` as a project-local fallback for this machine.
- Android emulator API access should use `http://10.0.2.2:4030`.
- Android emulator Metro access should use `http://10.0.2.2:8081`.
- Local mobile usage notes are tracked in [`apps/mobile/README.md`](/C:/project/my-mate/apps/mobile/README.md).

## Product Reality Check

The main remaining gap is no longer whether the repository has an orchestrator
loop.

That loop now exists and is reusable:

- user message -> orchestrator interpretation
- working goal / constraints / pending decision update
- workspace snapshot refresh
- explicit intents can auto-transition into draft / plan / revise / confirm / run
- execution state still projects back into the same thread after a real run opens
- intervention capture and patch proposal already exist

The correction that now matters is different:

- the exposed product is still too Session/thread-centric
- the center workspace is still too card-derived
- outputs and checkpoints are still not first-class enough
- a first-cut durable `mission_spec_contract` now exists above revisions and
  runs, but it is still file/session-metadata backed rather than a separate
  materialized store
- runtime steering is only partially real

So the current product is no longer "run-first forms with status polling".

But it is also not yet the target product.

The target product is:

- a Mission workspace with a conversation rail
- backed by a durable orchestration contract
- backed by a runtime that can steer, checkpoint, and deliver

## Target Product Model After Dual-Video Alignment

The product should move to a mission/workspace/spec-first orchestration loop.

### 1. Mission object

The top-level user-facing object should become `Mission` or an equivalent task
workspace object.

`Session` remains important, but as the conversation rail inside the Mission.
`Run` remains important, but as an execution object inside the Mission.

### 2. Conversation rail

Conversation remains essential for:

- intent capture
- clarifying questions
- approvals
- runtime intervention
- orchestrator explanation

But conversation should no longer be the whole product shell.

### 3. MissionSpec / orchestration contract

The product needs a durable contract that holds:

- objective
- constraints
- selected route
- work packages / pipelines
- checkpoints
- expected outputs
- revision lineage

This should sit above ad hoc plan cards and patch proposals.

### 4. Workspace projection

The center workspace should continuously project:

- current objective
- active pipelines
- work packages
- pending decisions
- checkpoints
- generated outputs
- execution snapshots

The conversation rail remains the human-readable record.

### 5. Runtime steering

The runtime should increasingly support:

- pause and resume
- change parallelism
- add or skip work
- checkpoint-aware intervention
- clearer progress / cost / monitoring surfaces

## Shortest Path With Current OpenClaw Capability

The honest split is now:

- `P1.5` is complete
- `P1 thread-shell tightening` is functionally closed for the current projection-based shell
- `P2 runtime steering` now has intervention capture, patch proposal records, and live application for `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and `resume_with_patch`; broader natural-language op mapping and finer patch review ergonomics are still remaining

### P1.5: conversation-native orchestration loop

This slice is now implemented.

Delivered behavior:

- `POST /api/sessions/:sessionId/messages` performs orchestrator interpretation
- session working state updates beyond `current_goal`
- structured orchestrator artifacts are emitted each turn
- ordinary user messages refresh the workspace even before run creation
- deterministic message-driven draft / plan / revise / confirm / run transitions exist
- failure paths now return explicit orchestrator replies and coherent session state

The thread can now honestly say:

- "I said something, the orchestrator understood it"
- "the task brief changed"
- "the workspace changed"
- "the system asked me for the next real decision"

### P2: runtime steering and real run mutation

This is where OpenClaw and the run engine become part of the live conversational control loop.

Implemented slices:

- session intervention API
- file-backed intervention records
- read-time `intervention_card` projection
- mobile runtime composer capture
- file-backed `DagPatchRecord`
- intervention-to-patch proposal mapping for `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and guidance capture
- read-time `dag_patch_card` projection
- mobile patch proposal rendering in the runtime workspace
- patch confirmation / rejection API (`POST /api/sessions/:sessionId/patches/:patchId/confirm` and `.../reject`)
- live application for `pause_for_replan` (run pause + adapter notify), `skip_node` (node skip + downstream unlock + adapter notify), `add_node` (runtime step insertion + edge rewrite), `change_parallelism` (scheduler capacity update), and `resume_with_patch` (resume / frontier refresh), including `applied_with_errors` partial outcomes
- per-operation `apply_supported` flag for all currently wired runtime patch operations

Remaining P2 work:

- expand natural-language intervention mapping beyond the current deterministic pause / resume / skip / add-step / change / parallelism rules
- improve mobile-side fine-grained runtime patch review and approval ergonomics

Only in this stage does the user get true "I changed the plan while it was running" behavior.

## OpenClaw Alignment

OpenClaw is already relevant, but only for execution.

Current state:

- planning and conversation do not talk to OpenClaw
- run creation compiles a run plan
- execution dispatch can go through the OpenClaw bridge
- execution callbacks are projected back into the session thread

So the correct framing is:

- current OpenClaw integration = execution adapter path
- missing product layer = orchestrator interpretation and runtime steering loop above it

The next step is not "use OpenClaw earlier everywhere".

The next step is:

- make the session thread produce real orchestrator state transitions before run creation
- then make recorded runtime interventions mutate OpenClaw-backed execution in the next P2 slice

## Immediate Build Order

The most effective implementation order from here is:

1. lift the current Session shell into a Mission-shaped product shell
2. add a durable MissionSpec or equivalent orchestration contract above plan cards and runs
3. drive the middle workspace from Mission + MissionSpec, not mainly from raw cards
4. keep Session as the conversation and audit rail
5. promote outputs, checkpoints, and active pipelines to first-class workspace surfaces
6. only after that, extend runtime patch apply beyond `pause_for_replan` and `skip_node`

## Remaining Work

### P1.6: mission workspace shell correction

- [x] introduce a Mission-shaped read model above the current Session object
- [ ] keep Session as the conversation rail, not the full product shell
- [x] add a first-cut durable MissionSpec contract as
  `mission_spec_contract`, persisted on session metadata and returned by
  mission/session workspace APIs
- [x] promote work packages, checkpoints, pipelines, and outputs into the main workspace
- [ ] make the center workspace feel persistent rather than card-derived
- [ ] keep raw plan/run/evidence cards as secondary audit surfaces

### P1: smarter orchestration planning and execution projection

- [x] intent -> template selection now uses a pluggable `PlannerProvider` registry with `rule_based_v1` (fallback), `local_semantic_v1` (domain dictionary rerank, EN+ZH), and `llm_claude_v1` (Anthropic tool-use). Provider is selected by `MY_MATE_PLANNER_PROVIDER`; non-template errors transparently fall back and annotate `planner_context.provider_id` / `fallback_used` / `fallback_reason`.
- [x] seeded domain-aligned published templates (`content-writing-studio`, `research-report`, `customer-followup-loop`, `ops-incident-response`, `release-approval-gate`) plus matching agent profiles and skills, and reworked `local_semantic_v1` rerank to (1) score every published template instead of only the rule-based top-5, (2) use Jaccard-style domain overlap so single-domain specialists beat multi-domain catch-all demos, (3) trust `metadata.domain` as authoritative when set to a known domain, with a small post-blend bonus to break ties against templates that only inherit a cue through node text. Six representative ZH intents (content / coding / research / customer / ops / review) now route to the correct domain template.
- [ ] rule-based token scoring still uses `value.toLowerCase().match(/[\p{L}\p{N}]+/gu)`, which treats a whole CJK run as one token. `local_semantic_v1` masks this by blending with domain boost, but pure rule-based ranking on ZH intents collapses to the 0.1 fallback band â€?only an issue if `MY_MATE_PLANNER_PROVIDER=rule_based_v1` is used directly with ZH intents.
- [x] session shell and task thread product object now exist
- [x] planner output can be projected into a session thread
- [x] execution summary can now be projected back into the session thread automatically
- [x] approval and human input requests can now be rendered inline in the session thread
- [x] artifact creation can now be projected into the session thread
- [x] session thread now supports visible plan revision history
- [x] session thread now supports visible plan revision diff summaries
- [x] session thread now supports explicit plan confirmation before execution
- [x] session thread now exposes alternative template candidates from the deterministic planner
- [x] session thread now supports a basic rule-based revise-request -> new revision loop
- [x] revise loop can now mutate plan structure for explicit requests like review-step insertion and parallelism changes
- [x] revise loop now supports targeted approval placement and fan-out then consolidate patterns
- [ ] projection is still read-time derived, not a separate evented session materializer
- [x] thread now shows primary and alternative full plan options side by side in one revision card
- [x] thread now generates two full compiled plan options when the deterministic recommendation list has at least two candidates
- [x] intent -> DAG draft generation is now implemented in the mobile session flow
- [ ] registry-aware agent and skill recommendation is still basic
- [x] human confirmation before run now exists in a guided session-level revision + option confirmation flow
- [ ] human confirmation can still be expanded into stronger plan editing controls and richer pre-run intervention
- [ ] revise-plan understanding is still rule-based and only covers a narrow set of deterministic structural mutations
- [ ] orchestrator-side autonomous DAG synthesis does not exist yet
- [ ] LLM-based planner or DAG synthesizer does not exist yet

### P1: conversation-native thread shell alignment

This slice is the current focus for closing P1 toward a stronger product loop.

The goal is not to add runtime DAG mutation yet. The goal is to make the mobile
thread feel like a real orchestrator workspace instead of a planner card feed.

- [x] replace split summary panels with a stronger `orchestrator turn stream`
- [x] make orchestrator narration read like one continuous task story
- [x] add a `work package` surface inside the thread for the current active work
- [x] group plan and run state into plain-language task work units instead of only raw cards
- [x] reduce the visual dominance of the raw event timeline while keeping it available
- [x] keep running-stage user input thread-first, even before real runtime DAG patching exists
- [x] keep this slice projection-based on top of current session/run truth
- [x] do not add LLM planning or autonomous DAG synthesis in this slice

Recent closure:

- [x] Thread stage now renders only user and orchestrator text turns as conversation bubbles.
- [x] `Current conversation` preview now shows recent text turns only, not raw planner cards.
- [x] Evidence cards are still available through an explicit `Evidence cards` drawer.
- [x] Confirmation echoes are normalized into lightweight orchestrator replies such as `Confirmed plan vN / option`.
- [x] Wide mode now keeps conversation on the right rail and reserves the left / center area for generated work artifacts.
- [x] Wide mode now exposes read-time process snapshots and audit evidence without requiring users to inspect the raw timeline first.
- [x] Structured orchestrator turns now read as intent-aware task progress instead of generic transition acknowledgements.
- [x] Running-stage approvals and human-input gates now surface inside the main workspace instead of only living in the evidence rail.
- [x] Running-stage composer guidance now explicitly captures next-pass intervention intent without pretending to do live DAG mutation.

### P1 / P2 boundary for video alignment

To keep scope honest, the remaining product gap is now split as follows.

#### Still in P1

- `orchestrator turn stream`
- `work package` working surface
- mobile thread layout closer to a conversation-first orchestrator shell
- stronger task-first copy and interaction structure
- running-stage intervention intent capture without real runtime plan mutation

#### Must move to P2

- [x] `POST /api/sessions/:sessionId/interventions`
- [x] first-class intervention record projection into the mobile thread
- [x] runtime `DagPatchRecord`
- [x] proposed `change_parallelism` operation mapping
- [x] proposed `add_node` operation mapping
- [x] proposed `skip_node` operation mapping
- [x] proposed `pause_for_replan` operation mapping
- [x] `resume_with_patch`
- [x] real confirmed runtime steering can change the executing run for supported operations
- [ ] natural-language runtime steering is still rule-based and needs broader dynamic op mapping

### P2: runtime control

- [x] basic session intervention API is implemented
- [x] mobile running-stage composer records explicit intervention records
- [x] intervention records appear in workspace / execution narrative
- [x] structured DAG patch proposals are generated and shown in mobile
- [x] patch confirm / reject API is wired and live-applies `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and `resume_with_patch`
- [x] runtime skip node is wired through patch confirm
- [x] runtime add node is wired through patch confirm
- [x] runtime parallelism change is wired through patch confirm
- [x] pause -> edit plan -> resume foundation exists through `resume_with_patch`
- [ ] dynamic fanout agent count is not implemented
- [ ] mobile-side fine-grained runtime patch review and approval is still limited

### P3: Studio graph experience

- [ ] Studio is still form-based, not a drag-and-drop graph canvas
- [ ] node connection visualization is not implemented
- [x] read-only run-time graph view is implemented
- [ ] interactive runtime graph canvas/editing is not implemented
- [x] basic route compare / workflow diff surface is implemented
- [ ] richer interactive compare selector and history browser are not implemented

### Mobile productization

- [ ] advanced orchestration configuration is not implemented on mobile
- [ ] push notification flow is not implemented
- [ ] offline support is not implemented
- [ ] full account system is not implemented
- [ ] permission layering and RBAC are not implemented on mobile

### Storage, tenancy, and governance

- [ ] current persistence is still file-backed
- [ ] database-backed production storage is not implemented
- [ ] multi-tenant workspace support is not implemented
- [ ] workspace permissions are not implemented
- [ ] audit logs are not implemented
- [ ] RBAC is not implemented across the platform
- [ ] registry approval workflow is not implemented

### OpenClaw production bridge

- [ ] large-scale concurrency handling is not implemented
- [ ] timeout compensation is not implemented
- [ ] failure replay is not implemented
- [ ] container health checks are not implemented
- [ ] resource isolation is not implemented
- [ ] task queueing is not implemented

### Observability

- [ ] unified dashboard is not implemented
- [ ] tracing is not implemented
- [ ] metrics are not implemented
- [ ] run and node latency views are not implemented
- [ ] agent cost tracking is not implemented
- [ ] failure reason aggregation is not implemented

### Shared types and SDK

- [ ] schemas and OpenAPI drafts exist
- [ ] generated shared client SDK does not exist yet
- [ ] mobile and Studio still contain handwritten types in some areas

## Recommended Priority

1. **P1 shell correction**
   - lift the product from Session/thread-first toward Mission/workspace-first
   - introduce MissionSpec above revisions and runs
   - make outputs, checkpoints, and active pipelines first-class surfaces
   - reduce dependence on card-by-card workspace assembly
   - keep human confirmation before publish or run
2. **P2 runtime control**
   - add `DagPatchRecord` application beyond `pause_for_replan` / `skip_node`
   - add dynamic fanout
   - allow runtime node insertion or skip
   - support pause, edit, and resume
   - add richer monitoring / cost / checkpoint-aware steering
3. **P3 Studio graph workbench**
   - replace form-only editing with a graph canvas
   - add run-time topology visualization
   - add diff and version comparison

## Verification Snapshot

- Mobile type check:
  - `cd apps/mobile && npm run check`
- Mobile tests:
  - `cd apps/mobile && npm test`
- Visual acceptance reference:
  - [`docs/07-visual-acceptance-guide.md`](/C:/project/my-mate/docs/07-visual-acceptance-guide.md)

## Related Documents

- [`README.md`](/C:/project/my-mate/README.md)
- [`docs/01-my-mate-overall-architecture.md`](/C:/project/my-mate/docs/01-my-mate-overall-architecture.md)
- [`docs/07-visual-acceptance-guide.md`](/C:/project/my-mate/docs/07-visual-acceptance-guide.md)
- [`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)
- [`apps/mobile/README.md`](/C:/project/my-mate/apps/mobile/README.md)
