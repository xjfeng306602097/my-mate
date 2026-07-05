# Hermes Desktop Gap Analysis And Next Iteration Plan

This document turns the current Hermes Desktop comparison into a durable
tracking artifact for My Mate.

It is intended to answer four practical questions:

1. what Hermes Desktop capabilities are the most relevant comparison baseline
2. which of those capabilities My Mate already has today
3. which gaps are only partially closed versus still missing
4. what the next development iteration should actually build, in priority order

This document builds on:

- [`docs/08-current-status-and-next-steps.md`](/C:/project/my-mate/docs/08-current-status-and-next-steps.md)
- [`docs/12-phased-implementation-plan.md`](/C:/project/my-mate/docs/12-phased-implementation-plan.md)
- [`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)

## Reference Baseline

The Hermes comparison baseline in this document was reviewed on June 27, 2026
from the official Hermes documentation:

- [Hermes Desktop App](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
- [Hermes Sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions)
- [Hermes Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)
- [Hermes Kanban (Multi-Agent Board)](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)

Important scope note:

this document does **not** assume every Hermes Desktop feature should be copied
1:1.

For My Mate, the highest-priority parity targets are:

- mission workspace quality
- orchestration visibility
- runtime steering
- desktop control ergonomics for long-running task work

Lower-priority parity targets include:

- voice mode
- messaging-channel setup breadth
- generalized management breadth that does not yet unblock the core Mission
  workspace product

## Status Definitions

- `Completed`
  - A meaningful user-facing equivalent exists in the current repository.
- `Partial`
  - The capability exists in one slice, one surface, or one read model, but is
    not yet product-complete.
- `Not Started`
  - No meaningful implementation was found in the current repository state.

## Progress Summary

Current rough parity read against the selected Hermes Desktop baseline:

- `Completed`: 7
- `Partial`: 5
- `Not Started`: 6

Overall weighted completion estimate:

- around `65% to 70%`

That means the repository is already past the "concept only" stage.

But it is still missing several of the things that make Hermes Desktop feel
like a fully mature desktop orchestration surface:

- version/diff visibility
- runtime graph visibility
- complete runtime patch application
- richer desktop control ergonomics

## Capability Matrix

| Area | Capability | Hermes Desktop baseline | My Mate current state | Status | Primary evidence | Main remaining gap |
|---|---|---|---|---|---|---|
| Workspace shell | Desktop workspace shell with left-nav and management panes | Hermes is a native chat-first desktop app with navigation and management surfaces | Studio already exposes `Missions`, `Sessions`, `Agents`, `Templates`, `Registry`, and `Settings` inside a `Desktop Workspace` shell | Completed | [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [apps/studio/README.md](/C:/project/my-mate/apps/studio/README.md) | Shell exists, but not yet as broad or polished as Hermes Desktop |
| Workspace shell | Mission workspace center + evidence/right rail | Hermes uses a main work area plus a preview/management side rail | My Mate already has a Mission Workspace center plus a right rail for run state and evidence | Completed | [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md) | Right rail is evidence-oriented, but not yet a full desktop preview / file / tool-output rail |
| Conversation and orchestration | Planning and execution in the same thread/workspace | Hermes keeps work continuous across sessions and surfaces | Session thread already projects plan, run, approvals, human input, artifacts, and runtime summaries back into the same flow | Completed | [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md) | Needs stronger Mission-above-Session framing |
| Conversation and orchestration | Route comparison before confirmation | Hermes supports iterative conversation-driven work before commit | My Mate supports route comparison, plan revisions, plan options, compare-before-confirm guidance, and now a structured route diff read model | Completed | [services/control-plane/src/route-compare.ts](/C:/project/my-mate/services/control-plane/src/route-compare.ts), [apps/mobile/test/task-thread.test.ts](/C:/project/my-mate/apps/mobile/test/task-thread.test.ts) | Next step is richer compare selectors/history ergonomics |
| Runtime steering | Intervention capture and patch proposal trail | Hermes product grammar assumes continuous task steering | My Mate already records interventions, produces `DagPatchRecord` proposals, exposes confirm/reject patch review, and persists operation-level patch outcomes | Completed | [services/control-plane/src/app.ts](/C:/project/my-mate/services/control-plane/src/app.ts), [services/api-gateway/test/app.test.ts](/C:/project/my-mate/services/api-gateway/test/app.test.ts) | Next gap is richer visual runtime graph editing, not patch capture |
| Agent and registry | Agent, provider, skill, and runtime management | Hermes has settings panes, provider management, and management surfaces | Studio already has agent profiles, skills, registry, planner/runtime summaries, and execution runtime panels | Completed | [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [docs/07-visual-acceptance-guide.md](/C:/project/my-mate/docs/07-visual-acceptance-guide.md) | Still narrower than Hermes management breadth |
| Mission model | Durable MissionSpec / orchestration contract | Hermes Desktop is backed by stable session/config/runtime contracts | My Mate now exposes a first-class `MissionSpecSummary`, persists route/output/revision contract metadata on sessions, and rebuilds mission projections through a shared Control Plane builder | Completed | [services/control-plane/src/mission-workspace.ts](/C:/project/my-mate/services/control-plane/src/mission-workspace.ts), [services/control-plane/src/app.ts](/C:/project/my-mate/services/control-plane/src/app.ts), [services/control-plane/test/mission-workspace.test.ts](/C:/project/my-mate/services/control-plane/test/mission-workspace.test.ts) | Next maturity step is runtime graph visibility, not MissionSpec existence |
| Mission model | Work packages, checkpoints, outputs as first-class workspace surfaces | Hermes desktop and dashboard experiences read as work surfaces, not card piles | My Mate already shows stages, checkpoints, and work packages, but outputs/checkpoints are still not first-class enough | Partial | [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md) | Needs stronger top-level workspace ownership and output surfaces |
| Authoring | Desktop workflow authoring workbench | Hermes offers rich management/control UI | Studio MVP can create/edit templates, nodes, edges, planner drafts, lineage, registry, and validation | Partial | [apps/studio/README.md](/C:/project/my-mate/apps/studio/README.md) | Still MVP and still heavily form-driven |
| Authoring | Graph editing as a visual desktop canvas | Hermes desktop quality implies richer desktop-native controls | My Mate can edit DAGs, but graph editing is explicitly form-based and not drag-and-drop | Partial | [apps/studio/README.md](/C:/project/my-mate/apps/studio/README.md), [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md) | No visual graph canvas yet |
| Comparison and audit | Workflow diff and version compare | Hermes has better mature session/task management ergonomics | My Mate now exposes `RouteCompareSummary` for option/revision/confirmed-vs-latest compare and renders the result in Mobile and Studio | Completed | [services/control-plane/src/route-compare.ts](/C:/project/my-mate/services/control-plane/src/route-compare.ts), [services/control-plane/test/app.test.ts](/C:/project/my-mate/services/control-plane/test/app.test.ts), [apps/mobile/app/tasks/[sessionId].tsx](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx), [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js) | Needs richer interactive compare selector and history browser after P0 |
| Runtime steering | Full live DAG patch application | Hermes product direction supports continuous steering and orchestration changes | `pause_for_replan`, `skip_node`, `add_node`, `change_parallelism`, and `resume_with_patch` now apply live, persist operation outcomes, and project resumed topology back into Mobile/Studio | Completed | [services/control-plane/src/app.ts](/C:/project/my-mate/services/control-plane/src/app.ts), [services/control-plane/test/app.test.ts](/C:/project/my-mate/services/control-plane/test/app.test.ts), [apps/mobile/app/tasks/[sessionId].tsx](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx), [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js) | Next maturity step is visual graph patch preview/history ergonomics |
| Desktop ergonomics | Voice mode | Hermes Desktop has voice input/output support | No desktop voice mode was found in My Mate | Not Started | [Hermes Desktop App](https://hermes-agent.nousresearch.com/docs/user-guide/desktop) | Requires audio capture, STT/TTS routing, session integration |
| Desktop ergonomics | File browser for project workspace | Hermes Desktop can browse working directories and follow file activity | No desktop file browser surface was found in My Mate | Not Started | [Hermes Desktop App](https://hermes-agent.nousresearch.com/docs/user-guide/desktop) | Needs working-directory view, file preview, and selection model |
| Desktop ergonomics | Drag-and-drop file attach in chat | Hermes supports dropping files into chat for the next message | My Mate now has a reference-first session attachment model, Studio context-file intake, Gateway routes, workspace projection, and Mobile/Studio preview surfaces | Partial | [services/control-plane/src/session-attachment-store.ts](/C:/project/my-mate/services/control-plane/src/session-attachment-store.ts), [services/control-plane/src/app.ts](/C:/project/my-mate/services/control-plane/src/app.ts), [services/api-gateway/src/app.ts](/C:/project/my-mate/services/api-gateway/src/app.ts), [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [apps/mobile/app/tasks/[sessionId].tsx](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx) | Still missing native drag-and-drop upload and workspace file picker/browser |
| Desktop ergonomics | Command palette, keyboard remap, zoom, UI language switch | Hermes exposes command palette, rebindable shortcuts, zoom, and in-app language switching | Studio now has a command palette, `Ctrl/Cmd+K`, command execution for workspace navigation and refresh, and keyboard navigation for mission/session inventories | Partial | [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js), [apps/studio/src/styles.css](/C:/project/my-mate/apps/studio/src/styles.css), [apps/studio/scripts/check.mjs](/C:/project/my-mate/apps/studio/scripts/check.mjs), [Hermes Desktop App](https://hermes-agent.nousresearch.com/docs/user-guide/desktop) | Still missing keyboard remapping, zoom controls, and in-app language switching |
| Session management | Session search, archive, and session hygiene | Hermes supports session archive and direct session search by id | My Mate now supports session/mission search, archive/unarchive, hidden-state plumbing, filtered active/archived lists, and direct open by stable session id in Mobile and Studio | Completed | [services/control-plane/src/session-store.ts](/C:/project/my-mate/services/control-plane/src/session-store.ts), [services/control-plane/src/app.ts](/C:/project/my-mate/services/control-plane/src/app.ts), [apps/mobile/app/tasks/index.tsx](/C:/project/my-mate/apps/mobile/app/tasks/index.tsx), [apps/studio/src/app.js](/C:/project/my-mate/apps/studio/src/app.js) | Next maturity step is command-palette navigation across large inventories |
| Management breadth | Cron, messaging channels, profiles breadth, agents/command-center breadth | Hermes Desktop and Dashboard surface cron, messaging, profiles, and broader multi-agent management | My Mate has registry/runtime foundations but not these broader management surfaces; docs also note unified dashboard is not implemented | Not Started | [Hermes Desktop App](https://hermes-agent.nousresearch.com/docs/user-guide/desktop), [Hermes Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard), [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md) | Needs broader product-management layer after core mission workspace closes |

## Main Product Reading

The current repository should be read as:

- already strong enough to demo a Mission/workspace direction
- already beyond a run-form MVP
- already capable of session-native planning and partial runtime steering

But it should **not** yet be read as:

- a full Hermes Desktop equivalent
- a fully mature desktop authoring/runtime control app
- a complete dynamic orchestration shell

The biggest product correction is still the same one already called out in the
repository roadmap:

- move from Session/thread-first toward Mission/workspace-first
- add a durable MissionSpec layer above cards and runs
- make graph/diff/runtime state more visible and operable

## Direction Alignment With Existing My Mate Product Logic

The Hermes comparison should not be treated as "copy the competitor UI".

My Mate already has a real product logic and architecture logic of its own.
The right question is:

- what should stay stable from My Mate's original design
- what should be corrected based on the video references and current product
  learnings
- what Hermes-like features should wait until the core product grammar is right

### What Should Stay Stable

These are not accidental implementation details.
They are correct architectural choices and should remain stable.

#### 1. Control Plane remains the source of truth

From the original product logic:

- clients do not directly mutate run truth
- OpenClaw does not become the business-state owner
- templates must compile into RunPlan before execution

This remains correct even after the Mission/workspace redesign.

Why:

- Hermes-like product polish does not remove the need for clear system truth
- runtime steering becomes more important, not less, when tasks get longer
- once interventions and DAG patching exist, source-of-truth discipline matters
  even more

Keep:

- Control Plane as run/node truth owner
- Execution Adapter as translation layer
- OpenClaw as execution substrate
- client surfaces as command + projection consumers

#### 2. Session remains useful, but only as the conversation rail

The previous Session-first move was not a mistake.

It solved a real gap:

- one thread for request, plan, run updates, approvals, and artifacts

That should stay.

But the video alignment and the newer roadmap both make the next correction
clear:

- Session is not the final top-level product object
- Mission must sit above Session

Keep:

- Session APIs
- Session message history
- thread-native intervention capture
- thread as human-readable audit trail

Do not keep:

- Session as the full exposed product shell

#### 3. Run remains a real execution object, not the user-facing anchor

The original product logic is still right that `Run` is an execution object.

That means My Mate should continue to:

- preserve RunPlan compilation discipline
- preserve node/run lifecycle truth
- preserve approval and human-input control through the Control Plane

But the user-facing product should not snap back to:

- run-first forms
- run-detail telemetry as the main trust surface

### What The Video Slices Confirmed Was Correct

The earlier video analysis and dual-video alignment already validated several
recent My Mate product moves.

These directions were correct and should be continued, not reversed.

#### 1. Move from create-run toward task-first intake

The video reference clearly showed:

- the task is the first object on screen
- the center of gravity is not a setup wizard

That validates My Mate's move toward:

- `Tasks`
- Session thread entry
- message-driven planning and execution

This means:

- do not re-invest heavily in the old `Create Run` shell
- keep it only as a compatibility or fallback path

#### 2. Merge planning and execution into one orchestrator story

The video review emphasized:

- one continuous narrative
- visible decomposition
- execution as a continuation of the same task

That validates:

- planner output projected into thread/workspace
- run updates projected back into the same task flow
- approvals and human-input gates surfaced in the same workspace

This is already one of My Mate's strongest product decisions.

#### 3. Keep DAG and low-level topology behind a humane surface

The reference did not force users into raw graph editing during the main flow.

That validates My Mate's layered model:

1. task / mission conversation
2. work packages / checkpoints / outputs
3. optional DAG or graph inspection

This is important because it means:

- visual graph work matters
- but graph-first UI should not become the top-level product grammar

### What Must Be Corrected In My Mate's Current Direction

The current product is directionally better than the original run-first MVP,
but still over-rotates in a few places.

#### 1. The workspace is still too card-derived

Today the center area is much better than before, but it still too often feels
like:

- a curated feed of cards

rather than:

- a persistent mission workspace

The video slices and Hermes baseline both suggest the same correction:

- cards should become evidence and support surfaces
- the main workspace should be a durable orchestration projection

#### 2. Outputs are still weaker than they should be

The video reference strongly emphasized:

- deliverables in progress
- concrete outputs during the task

My Mate still tends to over-surface:

- status
- cards
- route state

and under-surface:

- draft outputs
- branch outputs
- checkpoint snapshots
- final handoff quality

That means the next iteration should treat outputs as product surfaces, not only
artifacts metadata.

#### 3. Runtime steering is still only partially real

The orchestration-alignment video was clear that long-running work needs:

- steering
- checkpoints
- parallelism control
- revision while work is alive

My Mate now has a meaningful first slice:

- intervention capture
- patch proposals
- partial live apply

But it is still short of the target model.

That is why runtime patch completion belongs in P1, not as a distant someday
item.

### What Should Not Be Prioritized Too Early

Hermes has several broad desktop product features.
Not all of them should outrank My Mate's core product corrections.

The following are real features, but should stay behind Mission/workspace
closure:

- voice mode
- broad messaging-channel setup
- generalized desktop management breadth
- visual graph canvas as the primary work mode

Reason:

without MissionSpec, diff visibility, runtime graph visibility, and stronger
output surfaces, these features decorate the shell without resolving the core
product identity.

## Recommended Product Direction

Combining:

- My Mate's original product logic
- the Bilibili front-stage product-shell review
- the dual-video orchestration/runtime alignment
- the Hermes Desktop comparison

the right direction is:

- keep the current control-plane and execution boundary discipline
- keep Session as conversation rail and audit object
- lift the visible product into Mission/workspace/spec-first
- make outputs, checkpoints, and work packages the main trust surfaces
- keep DAG and runtime topology inspectable but secondary
- complete runtime steering after the Mission shell becomes stable

This can be summarized as:

- **do not go back to run-first**
- **do not stop at session-first**
- **do not jump straight to graph-first**
- **move to mission/workspace/spec-first**

## Product Decision Rules For The Next Iteration

Use these rules when making implementation choices in the next wave.

### Rule 1

If a feature improves task-first intake, mission visibility, outputs,
checkpoints, or orchestration understanding, it should usually rank above
general desktop niceties.

### Rule 2

If a feature makes the user read fewer raw cards and understand more durable
workspace state, it is likely aligned with the target direction.

### Rule 3

If a feature pressures the architecture to let clients or OpenClaw own run
truth, it is misaligned and should be rejected.

### Rule 4

If a feature improves graph authoring but weakens plain-language mission
control, it should be delayed or kept secondary.

### Rule 5

If a feature helps the user see concrete outputs and decisions in progress, it
is more valuable than another telemetry-only view.

## Recommended Next Iteration Backlog

The next iteration should not chase every Hermes Desktop feature at once.

It should prioritize the gaps that most directly improve:

- mission workspace credibility
- orchestration inspectability
- runtime steerability
- desktop task control ergonomics

### P0

P0 should land the missing core workspace and orchestration visibility pieces.

- [ ] `MissionSpec` first slice
  - Add a durable MissionSpec or equivalent read model above plan revisions and
    runs.
  - Include:
    - objective
    - constraints
    - chosen route
    - active pipelines
    - checkpoints
    - expected outputs
    - revision lineage
  - Acceptance:
    - Mission workspace can render from MissionSpec rather than mainly from raw
      cards.
    - Session and run flows remain backward compatible.

- [x] Workflow diff and version compare
  - Add a dedicated compare surface for:
    - revision vs revision
    - option vs option
    - changed nodes / changed edges / changed approvals / changed outputs
  - Acceptance:
    - A user can inspect "what changed" before confirm/run without reading raw
      cards.
    - Mobile and Studio can both consume the same compare summary model.

- [x] Run-time graph view
  - Add a read-only graph/topology surface for:
    - compiled nodes
    - edges
    - current node state
    - skipped/paused/waiting markers
  - Acceptance:
    - A user can understand current execution topology without reading the raw
      timeline.
    - Mission workspace can deep-link from work package to node/graph context.

- [x] Promote outputs, checkpoints, and pipelines into first-class workspace
  surfaces
  - Move these surfaces from "derived secondary panels" into the center
    workspace grammar.
  - Acceptance:
    - The center workspace reads as persistent work state, not mainly as a
      better card feed.

### P1

P1 should make runtime control and desktop task management materially more
useful after the P0 mission-shell work lands.

- [x] Complete live DAG patch application
  - Implement live apply for:
    - `add_node`
    - `change_parallelism`
    - `resume_with_patch`
  - Acceptance:
    - Runtime steering can change the real run beyond pause/skip.
    - Patch apply results remain auditable in-thread.
  - Completed:
    - Patch confirmation now applies runtime node insertion, parallelism
      changes, and resumed dispatch; operation outcomes and resumed topology
      are persisted and projected into Mobile/Studio.

- [x] Session hygiene and search
  - Add:
    - session search
    - archive/hide flows
    - direct open by id or stable reference
  - Acceptance:
    - Growing session lists remain usable on desktop.
    - Mission/session navigation no longer depends on manual list scanning.
  - Completed:
    - Control Plane, Gateway, Mobile, and Studio now support active/archived
      inventory views, search filters, archive/restore actions, and direct
      stable-id open for archived sessions.

- [x] Desktop command palette and keyboard-first navigation
  - Add a command palette for:
    - switch mission/session
    - jump to templates/agents/registry
    - open compare view
    - open graph view
  - Acceptance:
    - Core workspace actions are reachable from keyboard without mouse-heavy
      navigation.
  - Completed:
    - Studio now exposes a `Ctrl/Cmd+K` command palette with mission/session
      switching, workspace compare/graph focus commands, top-level navigation,
      and runtime/workspace refresh commands.
    - Mission/session inventories support keyboard up/down selection and enter
      open while preserving normal form input behavior.

- [x] File/attachment first slice
  - Add:
    - desktop attachment intake
    - URI/reference selection from workspace context
    - preview of attached or generated files in the side rail
  - Acceptance:
    - A user can attach task context and inspect generated file artifacts
      inside the desktop shell.
  - Completed:
    - Added a reference-first session attachment model and API routes.
    - Studio can attach context-file references and preview attached context
      alongside generated run artifacts in the mission workspace.
    - Mobile renders attached context files as read-only mission material.
    - Native drag-and-drop upload and workspace file browsing remain future
      desktop ergonomics work.

### P2

P2 should expand breadth after the mission workspace and runtime control loop
are solid.

- [ ] Voice mode
  - Add microphone capture and voice-response plumbing for desktop sessions.

- [ ] Broader desktop management panes
  - Evaluate and selectively add:
    - cron / scheduled jobs
    - messaging channel setup
    - richer multi-profile management
    - command-center style multi-agent surfaces

- [ ] Unified dashboard slice
  - Add a broader operational view across:
    - missions
    - sessions
    - runs
    - runtime health
    - intervention backlog

- [ ] Visual graph canvas
  - Upgrade authoring from form-based DAG editing to a desktop-appropriate graph
    canvas after the graph/runtime model is stable.

## Priority Rationale

The recommended priority order is deliberate.

### Why P0 comes first

P0 closes the most important product gap:

- My Mate already has enough engine and session behavior
- but it still does not fully read like a stable Mission workspace product

Without P0, later desktop niceties mostly decorate an incomplete product shell.

### Why P1 comes second

P1 makes the shell operationally useful:

- real runtime mutation
- easier navigation across more sessions
- better desktop task-control ergonomics

This is where My Mate starts feeling less like a good prototype and more like a
real control surface.

### Why P2 comes third

P2 broadens the surface area, but does not unblock the core product identity.

These features matter, but they should not outrank:

- MissionSpec
- diff visibility
- graph visibility
- real runtime patch apply

## Tracking Checklist

Use this section as the lightweight ongoing tracker for the next development
wave.

### P0 Tracker

- [x] MissionSpec first slice
  - [x] contract fields and gateway/mobile fixtures
  - [x] Mobile and Studio MissionSpec-first rendering first pass
  - [x] builder extraction, persistence stabilization, and broader matrix
    coverage
- [x] Workflow diff and version compare
- [x] Run-time graph view
- [x] Outputs/checkpoints/pipelines promoted to first-class workspace surfaces

### P1 Tracker

- [x] `add_node` live apply
- [x] `change_parallelism` live apply
- [x] `resume_with_patch`
- [x] Session search
- [x] Session archive/hide
- [x] Command palette
- [x] Keyboard-first desktop navigation
- [x] File attach and preview first slice

### P2 Tracker

- [ ] Voice mode
- [ ] Cron management evaluation
- [ ] Messaging management evaluation
- [ ] Multi-profile management expansion
- [ ] Unified dashboard slice
- [ ] Visual graph canvas

## Engineering Task Breakdown

This section expands P0-P2 into implementation-facing task lists.

The goal is to make follow-up work assignable across:

- `services/control-plane`
- `services/api-gateway`
- `apps/mobile`
- `apps/studio`
- automated tests and acceptance checks

Use the following shorthand:

- `CP`: Control Plane
- `GW`: API Gateway
- `Mobile`: React Native mission/task shell
- `Studio`: desktop workflow and mission workspace shell
- `Tests`: unit/integration/e2e coverage

### P0 Engineering Tasks

P0 closes the mission/workspace/spec-first gap.

#### P0.1 MissionSpec first slice

Goal:

- turn the current derived `MissionSpecSummary` into a stronger, reusable
  mission contract model for all surfaces

Status:

- `Completed`
- P0.1 is now closed at the Control Plane contract, persistence, Gateway
  passthrough, Mobile rendering, and Studio rendering levels.

Current foundations:

- `MissionSpecSummary` already exists in
  [`services/control-plane/src/types.ts`](/C:/project/my-mate/services/control-plane/src/types.ts)
- session workspace and mission snapshot builders already exist in
  [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts)

Implementation status:

- 2026-06-27: contract first pass landed for Control Plane, API Gateway
  fixtures, and Mobile local projection builders. The first pass adds route,
  pipeline summary, checkpoint summary, and revision lineage fields to
  `MissionSpecSummary`.
- 2026-06-27: Mobile mission list/detail and Studio Mission Workspace now
  render MissionSpec explicitly. The visible UI consumes objective, route,
  pipeline summary, checkpoint summary, requested outputs, constraints, and
  revision lineage from `mission_spec` first, with snapshot/message-derived
  data kept as compatibility fallback.
- 2026-06-27: Control Plane MissionSpec/MissionSnapshot assembly now has a
  dedicated builder module in
  [`services/control-plane/src/mission-workspace.ts`](/C:/project/my-mate/services/control-plane/src/mission-workspace.ts),
  and session summary plus mission detail now read from the same canonical
  projection path instead of duplicating helper sprawl inside
  [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts).
- Remaining work: extract the builder into a cleaner module, stabilize
  persistence metadata across older sessions, and broaden stale/running mission
  contract coverage.

Engineering tasks:

- [x] CP: formalize MissionSpec read model shape
  - extend `MissionSpecSummary` or add a richer `MissionSpecDetail` type in
    [`services/control-plane/src/types.ts`](/C:/project/my-mate/services/control-plane/src/types.ts)
  - include:
    - objective
    - source brief
    - constraints
    - requested outputs
    - open questions
    - decision focus
    - selected route summary
    - active pipelines summary
    - checkpoint summary
    - revision lineage summary

- [x] CP: centralize MissionSpec assembly
  - refactor MissionSpec assembly out of
    [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts)
    helper sprawl into a dedicated builder block or helper module
  - make both mission list/detail and session workspace read from the same
    canonical assembly path
  - status: canonical assembly now lives in
    [`services/control-plane/src/mission-workspace.ts`](/C:/project/my-mate/services/control-plane/src/mission-workspace.ts)
    and is shared by session summary and mission detail projections

- [x] CP: persist enough metadata to stabilize MissionSpec across revisions
  - review `session-store`, `session-message-store`, and plan-confirm/revise
    paths
  - ensure selected route, confirmed route, revision lineage, and requested
    outputs can be reconstructed without brittle card scanning
  - keep backward compatibility with existing session data files
  - status: session persistence now records:
    - `metadata.mission_route_state`
    - `metadata.mission_requested_outputs`
    - `metadata.mission_revision_lineage`
    - root-level `session.mission_spec`
    - root-level `session.mission_snapshot`
  - status: plan, revise, confirm, run launch, runtime callback, intervention,
    and patch flows refresh the MissionSpec projection through the same
    session working-state sync path
  - status: the Mission workspace builder can also rebuild the route contract
    from persisted metadata when planning cards are unavailable

- [x] GW: expose stable MissionSpec payloads without shape drift
  - ensure `/api/missions`, `/api/missions/:id`, and `/api/sessions/:id`
    responses return the same MissionSpec contract fields
  - extend gateway tests in
    [`services/api-gateway/test/app.test.ts`](/C:/project/my-mate/services/api-gateway/test/app.test.ts)
  - status: missions list, mission detail, and session detail now have
    Gateway passthrough assertions for the stable MissionSpec contract and
    persisted metadata fields

- [x] Mobile: render MissionSpec as the primary mission brief surface
  - update
    [`apps/mobile/lib/types.ts`](/C:/project/my-mate/apps/mobile/lib/types.ts)
    and
    [`apps/mobile/lib/task-thread.ts`](/C:/project/my-mate/apps/mobile/lib/task-thread.ts)
  - status: type and local projection builder sync is complete; mission list
    and mission detail now prefer `mission_spec` / `missionSnapshot.spec` for
    objective, active route, pipeline summary, checkpoint summary, requested
    outputs, and revision lineage
  - update
    [`apps/mobile/app/tasks/index.tsx`](/C:/project/my-mate/apps/mobile/app/tasks/index.tsx)
    and
    [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
    so mission header and workspace cards read from MissionSpec first, not
    inferred card fragments

- [x] Studio: render MissionSpec explicitly in the desktop workspace
  - update
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
    to add a dedicated MissionSpec panel or summary band
  - stop overloading generic summary cards as the main route explanation
  - status: desktop mission list now uses MissionSpec route signals, and the
    Mission Workspace has a dedicated MissionSpec summary band plus route,
    output, constraint, checkpoint, and revision-lineage panels

- [x] Tests: add contract-level MissionSpec coverage
  - CP tests for:
    - draft-only mission
    - compared-route mission
    - confirmed-route mission
    - running mission
    - stale-route mission
  - Mobile tests for MissionSpec-driven snapshot rendering
  - Studio static check for MissionSpec surface
  - status: CP/Mobile/Gateway contract assertions are in place, and Control
    Plane now also has dedicated builder coverage for draft, compare,
    confirmed, running, stale, and persisted-metadata fallback mission
    projections in
    [`services/control-plane/test/mission-workspace.test.ts`](/C:/project/my-mate/services/control-plane/test/mission-workspace.test.ts);
    Gateway coverage includes `/api/sessions/:id` MissionSpec passthrough in
    [`services/api-gateway/test/app.test.ts`](/C:/project/my-mate/services/api-gateway/test/app.test.ts)

Definition of done:

- MissionSpec is a first-class response contract, not only an internal summary
- mission list, mission detail, session detail, Mobile, and Studio all consume
  the same stable MissionSpec fields
- selected route, confirmed route, revision lineage, and requested outputs are
  persisted on session metadata and can be rebuilt without depending only on
  raw planning cards

#### P0.2 Workflow diff and version compare

Goal:

- let users inspect route changes directly instead of reading planning cards to
  infer them

Engineering tasks:

- [x] CP: define a `RouteCompareSummary` response model
  - add compare types in
    [`services/control-plane/src/types.ts`](/C:/project/my-mate/services/control-plane/src/types.ts)
  - include:
    - left revision / option
    - right revision / option
    - changed nodes
    - changed edges
    - changed approvals / gates
    - changed outputs
    - changed risks / warnings
    - human-readable summary lines

- [x] CP: implement compare builder from plan options and compiled nodes
  - derive route comparison from `plan_card` / `plan_options_card` content plus
    compiled node metadata
  - isolate compare logic from UI-only helpers

- [x] CP: add compare endpoint(s)
  - recommended first slice:
    - `GET /api/sessions/:sessionId/compare?...`
    - or `GET /api/missions/:missionId/compare?...`
  - support:
    - revision vs revision
    - primary vs alternative
    - latest active vs confirmed

- [x] GW: expose compare endpoint(s)
  - add route rules in
    [`services/api-gateway/src/app.ts`](/C:/project/my-mate/services/api-gateway/src/app.ts)
  - add passthrough tests

- [x] Mobile: add route compare surface
  - add compare fetch helpers in
    [`apps/mobile/lib/api.ts`](/C:/project/my-mate/apps/mobile/lib/api.ts)
  - add compare view or compare panel in
    [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
  - update
    [`apps/mobile/lib/task-thread.ts`](/C:/project/my-mate/apps/mobile/lib/task-thread.ts)
    to summarize compare results as mission workspace sections

- [x] Studio: add compare panel in desktop workspace
  - add explicit compare section in
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
  - support side-by-side revision/option inspection

- [x] Tests: add compare-focused coverage
  - CP tests for:
    - option compare within one revision
    - compare after revise
    - compare when confirmed route exists
  - Mobile tests for compare recommendation and rendering
  - Studio smoke test for compare panel visibility

Definition of done:

- compare result is available as a structured API
- Mobile and Studio can both show "what changed" without raw-card archaeology

P0.2 completion notes:

- Added shared `RouteCompareSummary` types and the Control Plane builder in
  [`services/control-plane/src/route-compare.ts`](/C:/project/my-mate/services/control-plane/src/route-compare.ts).
- Added `GET /api/sessions/:sessionId/compare` with selectors:
  `left_revision`, `left_option`, `right_revision`, `right_option`.
- Default compare behavior now covers primary vs alternative, explicit
  revision-to-revision diff, and confirmed route vs latest route.
- Gateway, Mobile, and Studio now consume the same compare summary model.
- Verification passed:
  - `services/control-plane`: `npm run check`, `npm test`
  - `services/api-gateway`: `npm run check`, `npm test`
  - `apps/mobile`: `npm run check`, `npm test`
  - `apps/studio`: `npm run check`

#### P0.3 Run-time graph view

Goal:

- expose current execution topology as a readable mission/runtime surface

Engineering tasks:

- [x] CP: define graph view response shape
  - add graph types in
    [`services/control-plane/src/types.ts`](/C:/project/my-mate/services/control-plane/src/types.ts)
  - include:
    - nodes
    - edges
    - current node statuses
    - active frontier
    - skipped/blocked/waiting markers
    - node-to-work-package mapping

- [x] CP: build graph projection from RunPlan + node runs
  - use `run-plan-store`, `node-run-store`, and scheduler state
  - keep graph projection read-only for this slice

- [x] CP: add runtime graph endpoint
  - recommended first slice:
    - `GET /api/runs/:runId/graph`
    - optional mission/session alias if useful

- [x] GW: expose graph endpoint
  - update route allowlist in
    [`services/api-gateway/src/app.ts`](/C:/project/my-mate/services/api-gateway/src/app.ts)
  - add gateway test coverage

- [x] Mobile: add runtime topology panel
  - add graph fetch helper in
    [`apps/mobile/lib/api.ts`](/C:/project/my-mate/apps/mobile/lib/api.ts)
  - render a compact read-only topology view in
    [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
  - deep-link from work package cards into graph context

- [x] Studio: add desktop graph view
  - add a run-time graph panel in
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
  - use an initial simple node/edge visualization before full canvas work

- [x] Tests: graph projection coverage
  - CP tests for:
    - pending/ready/running/completed/skipped nodes
    - approval gate nodes
    - human-input gate nodes
  - UI smoke checks for non-empty graph rendering

Definition of done:

- a user can inspect current execution topology without reading raw event logs

Completion notes:

- Added shared runtime graph response types and projection builder in
  [`services/control-plane/src/runtime-graph.ts`](/C:/project/my-mate/services/control-plane/src/runtime-graph.ts).
- Added `GET /api/runs/:runId/graph` in Control Plane and Gateway allowlist
  passthrough.
- Mobile mission workspace now fetches the latest run graph, renders a compact
  and full read-only topology surface, and links pipeline cards into execution
  topology context.
- Studio mission workspace now fetches the latest run graph and renders a
  desktop topology panel with node, package, edge, frontier, gate, skipped, and
  blocked markers.
- Scope is intentionally read-only. Visual graph canvas and DAG editing remain
  P2 work after the runtime model is stable.
- Verification passed:
  - `services/control-plane`: `npm run check`, `npm test`
  - `services/api-gateway`: `npm run check`, `npm test`
  - `apps/mobile`: `npm run check`, `npm test`
  - `apps/studio`: `npm run check`

#### P0.4 Promote outputs, checkpoints, and pipelines to first-class workspace surfaces

Goal:

- make the workspace feel persistent and mission-shaped instead of card-derived

Engineering tasks:

- [x] CP: strengthen `mission_snapshot` projection
  - expand current snapshot builders in
    [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts)
  - ensure outputs, checkpoints, and pipelines are not merely counts but
    structured first-class sections

- [x] CP: separate workspace projection from raw evidence assembly
  - reduce dependence on scanning `artifact_card`, `summary_card`, and
    `plan_options_card` as the only source of truth for workspace display

- [x] Mobile: reorder task workspace layout
  - update
    [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
    to foreground:
    - mission brief
    - work packages
    - checkpoints
    - outputs
    - runtime section
  - keep evidence cards secondary/collapsible

- [x] Studio: rebalance desktop workspace layout
  - update
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
    so outputs/checkpoints/pipelines own more of the center surface
  - keep raw evidence in the right rail

- [x] Tests: projection and layout coverage
  - Mobile tests for workspace section ordering and output visibility
  - CP tests for snapshot content quality

Definition of done:

- outputs, checkpoints, and pipelines are visible as persistent main-surface
  product sections

Completion notes:

- Added `MissionOutput` and `MissionWorkspaceSection` to the shared mission
  snapshot contract so outputs, pipelines, checkpoints, runtime, route, brief,
  and evidence are explicit workspace surfaces.
- Control Plane projection now builds `mission_snapshot.outputs` and
  `mission_snapshot.workspaceSections` from MissionSpec, compiled pipelines,
  runtime state, and returned artifacts.
- Mobile mission workspace now foregrounds pipeline cards, checkpoint cards,
  output ledger, and runtime topology in a stable order; evidence remains a
  secondary/collapsible audit surface.
- Studio mission workspace now renders a center `Mission Surfaces` grid and
  `Mission Outputs` ledger while keeping raw evidence in the right rail.
- Verification passed:
  - `services/control-plane`: `npm run check`, `npm test`
  - `services/api-gateway`: `npm run check`, `npm test`
  - `apps/mobile`: `npm run check`, `npm test`
  - `apps/studio`: `npm run check`

### P1 Engineering Tasks

P1 makes the workspace operationally stronger after the P0 mission-shell work
lands.

#### P1.1 Complete live DAG patch application

Status: Completed.

Goal:

- move runtime steering from partial to meaningfully real

Engineering tasks:

- [x] CP: complete operation application paths
  - implement live apply for:
    - `add_node`
    - `change_parallelism`
    - `resume_with_patch`
  - implement through Control Plane apply flow while reusing:
    - [`services/control-plane/src/control-actions.ts`](/C:/project/my-mate/services/control-plane/src/control-actions.ts)
    - [`services/control-plane/src/node-scheduler.ts`](/C:/project/my-mate/services/control-plane/src/node-scheduler.ts)
    - [`services/control-plane/src/local-execution-engine.ts`](/C:/project/my-mate/services/control-plane/src/local-execution-engine.ts)
    - [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts)

- [x] CP: extend patch proposal/application metadata
  - update `dag-patch-store` and related types so operation outcomes,
    application errors, and resumed topology are auditable

- [x] Execution Adapter: support resumed or mutated execution plans
  - review adapter contract behavior for:
    - new runnable nodes
    - changed dependency/frontier state
    - resume after patch

- [x] Mobile: improve patch review UX
  - update
    [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
    to show operation-level outcomes, support warnings, and post-apply state

- [x] Studio: add patch outcome visibility
  - expose applied vs failed operations and resumed topology in
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)

- [x] Tests: full runtime patch matrix
  - CP tests for each operation kind
  - adapter tests for resumed dispatch
  - regression tests for existing pause/skip flows

Definition of done:

- runtime intervention can materially reshape live execution beyond pause/skip

Completion notes:

- Control Plane now persists `operation_outcomes`, `application_errors`, and
  `resumed_topology` on `DagPatchRecord`, while keeping compatible copies in
  `metadata`.
- `add_node` inserts a compiled runtime node, rewires edges before final
  delivery when needed, unlocks ready nodes when dependencies are already
  satisfied, and records inserted node/edge details.
- `change_parallelism` mutates `policy_snapshot.max_parallel_nodes` and runs a
  scheduler pass so newly available capacity dispatches ready nodes.
- `resume_with_patch` resumes paused runs, refreshes the ready frontier, and
  records before/after topology for audit.
- Mobile patch cards and execution narrative now show post-apply outcomes,
  topology summary, and graph preview lines for proposed/applied patches.
- Studio right rail and execution queue now show runtime patch outcomes,
  resumed topology, and graph preview/history summaries.
- Studio Execution Cockpit now includes a `Patch Graph Review` panel that
  compares current, predicted, and actual topology snapshots for the latest
  patch with graph preview data.
- `DagPatchRecord` now persists `graph_preview` with before, predicted, and
  actual topology snapshots so patch review can explain graph impact before a
  full visual editor exists.
- Verification passed:
  - `services/control-plane`: `npm run check`, `npm test`
  - `apps/mobile`: `npm run check`, `npm test`
  - `apps/studio`: `npm run check`
  - Playwright fixture pass against local Studio confirmed the `Patch Graph
    Review` panel renders Current / Predicted / Actual columns.

#### P1.2 Session search and archive/hide

Status: Completed.

Goal:

- make growing mission/session inventories manageable

Engineering tasks:

- [x] CP: add session metadata operations
  - extend `SessionRecord` and `session-store` with archive/hide fields
  - add endpoints for:
    - archive
    - unarchive
    - filtered mission/session list queries

- [x] GW: expose new session management routes
  - update
    [`services/api-gateway/src/app.ts`](/C:/project/my-mate/services/api-gateway/src/app.ts)
    route rules

- [x] Mobile: add mission/session search and archive controls
  - update
    [`apps/mobile/app/tasks/index.tsx`](/C:/project/my-mate/apps/mobile/app/tasks/index.tsx)
  - add query state and filters via
    [`apps/mobile/lib/api.ts`](/C:/project/my-mate/apps/mobile/lib/api.ts)

- [x] Studio: add desktop search and archive controls
  - update mission/session sidebars in
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)

- [x] Tests: session management coverage
  - list filtering
  - archive visibility
  - direct open by stable id/reference

Definition of done:

- mission/session navigation remains usable as data grows

Completion notes:

- `SessionRecord` now carries archive and hidden-state fields with backward
  compatible defaults for existing stored session JSON.
- Control Plane exposes filtered `GET /api/sessions` and `GET /api/missions`
  queries with `q/search`, `status`, and `visibility=active|archived|hidden|all`.
- Control Plane exposes session visibility actions:
  `archive`, `unarchive`, `hide`, and `unhide`; default mission/session lists
  exclude archived and hidden sessions, while direct stable-id open still works.
- API Gateway proxies the new session visibility routes.
- Mobile mission inventory now has search, active/archived view switching, and
  archive/restore controls.
- Studio mission/session sidebars now have search, active/archived view
  switching, and selected-session archive/restore controls.
- Verification passed:
  - `services/control-plane`: `npm run check`, `npm test`
  - `services/api-gateway`: `npm run check`, `npm test`
  - `apps/mobile`: `npm run check`, `npm test`
  - `apps/studio`: `npm run check`

#### P1.3 Command palette and keyboard-first navigation

Status: Completed

Goal:

- reduce desktop interaction friction for frequent operators

Engineering tasks:

- [x] Studio: add command palette component
  - implement in
    [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
    and
    [`apps/studio/src/styles.css`](/C:/project/my-mate/apps/studio/src/styles.css)
  - first commands:
    - switch mission/session
    - open compare
    - open graph
    - jump to templates/agents/registry/settings
    - refresh runtime/workspace

- [x] Studio: add keyboard shortcuts
  - `Ctrl/Cmd+K` for palette
  - keyboard navigation for mission/session lists
  - shortcut hints in tooltips or labels where useful

- [x] Tests: desktop interaction smoke coverage
  - palette open/close
  - command execution
  - route switching

Definition of done:

- core desktop actions are reachable without mouse-heavy navigation

Completed:

- Studio command palette now opens from `Ctrl/Cmd+K` or the left-header
  command button and supports filtered command execution.
- First command set includes mission/session switching, route compare focus,
  runtime graph focus, navigation to Templates/Agents/Registry/Settings, and
  runtime/workspace refresh.
- Mission/session sidebars now support keyboard up/down selection and enter
  open outside text inputs.
- `apps/studio/scripts/check.mjs` now includes syntax plus static interaction
  smoke checks for palette wiring, command execution, route focus targets, and
  keyboard navigation markers.

Verification:

- `apps/studio`: `npm run check`

#### P1.4 File attach and preview first slice

Status: Completed

Goal:

- let task context and generated outputs behave more like working material

Engineering tasks:

- [x] CP: add session attachment metadata model
  - extend session message or mission artifact response shapes to support
    attached context files

- [x] CP: add upload/reference flow first slice
  - keep initial scope minimal:
    - metadata + storage URI reference
    - no advanced sync needed yet

- [x] GW: expose attachment routes
  - upload/reference and fetch metadata routes

- [x] Mobile: render attachment previews in task flow
  - first slice keeps intake desktop-only and renders previews on mobile

- [x] Studio: add desktop attach and preview surface
  - mission workspace context panel
  - right-rail preview for generated artifacts or attached files

- [x] Tests: attachment metadata and preview coverage

Definition of done:

- a mission can carry working context files and preview generated outputs in the
  desktop shell

Completed:

- Control Plane now persists `SessionAttachmentRecord` metadata under session
  ownership and exposes `GET/POST /api/sessions/:sessionId/attachments`.
- Session and mission detail responses plus workspace stream snapshots now
  include `attachments`.
- API Gateway allows the attachment list/create routes.
- Studio Mission Workspace has a context-file reference intake panel and right
  rail preview for attached context plus generated artifacts.
- Mobile task detail renders attached context files as read-only mission
  material; native mobile attach remains out of this first slice.

Verification:

- `services/control-plane`: `npm run check`, `npm test`
- `services/api-gateway`: `npm run check`, `npm test`
- `apps/mobile`: `npm run check`, `npm test`
- `apps/studio`: `npm run check`

### P2 Engineering Tasks

P2 broadens the product after the mission workspace and runtime control loop are
solid.

#### P2.1 Voice mode

Engineering tasks:

- [ ] Studio or desktop shell evaluation for microphone capture strategy
- [ ] speech-to-text ingestion into mission/session composer
- [ ] optional text-to-speech playback for orchestrator replies
- [ ] runtime permission handling and fallback UX
- [ ] tests for voice-toggle state and transcript ingestion

Definition of done:

- a user can create or steer a mission through voice without bypassing the
  normal session/control-plane flow

#### P2.2 Broader desktop management panes

Engineering tasks:

- [ ] evaluate cron/scheduled-job model and data ownership
- [ ] evaluate messaging-channel setup model
- [ ] evaluate whether profile management belongs in registry vs dedicated
  operations view
- [ ] prototype one management pane at a time in
  [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)

Definition of done:

- at least one broader management area is productized without weakening the core
  Mission workspace

#### P2.3 Unified dashboard slice

Engineering tasks:

- [ ] CP: define dashboard summary response
  - missions
  - sessions
  - runs
  - runtime health
  - intervention backlog
  - approvals backlog

- [ ] GW: expose dashboard route(s)

- [ ] Studio: add dashboard page or dashboard mode

- [ ] Tests: dashboard contract and smoke coverage

Definition of done:

- operators can inspect top-level platform workload and health in one view

#### P2.4 Visual graph canvas

Engineering tasks:

- [ ] Studio: choose graph canvas implementation approach
- [ ] map current node/edge editor state into canvas state
- [ ] support:
  - node add/remove/edit
  - edge add/remove/edit
  - node selection/details drawer
  - read-only runtime overlay mode
- [ ] keep schema/policy editing outside the graph where appropriate
- [ ] tests for basic canvas interactions and non-destructive persistence

Definition of done:

- authoring is no longer limited to form-only graph editing

## Suggested Ownership Split

To keep tracking practical, the next iteration can be staffed by workstream.

### Backend workstream

- MissionSpec first slice
- compare API
- graph API
- runtime patch completion
- session archive/search metadata
- attachment metadata model
- dashboard summary model

Primary modules:

- [`services/control-plane/src/app.ts`](/C:/project/my-mate/services/control-plane/src/app.ts)
- [`services/control-plane/src/types.ts`](/C:/project/my-mate/services/control-plane/src/types.ts)
- [`services/control-plane/src/control-actions.ts`](/C:/project/my-mate/services/control-plane/src/control-actions.ts)
- [`services/control-plane/src/node-scheduler.ts`](/C:/project/my-mate/services/control-plane/src/node-scheduler.ts)
- store modules under [`services/control-plane/src`](/C:/project/my-mate/services/control-plane/src)

### Gateway workstream

- new proxy routes for compare, graph, archive/search, attachments, dashboard

Primary modules:

- [`services/api-gateway/src/app.ts`](/C:/project/my-mate/services/api-gateway/src/app.ts)
- [`services/api-gateway/test/app.test.ts`](/C:/project/my-mate/services/api-gateway/test/app.test.ts)

### Mobile workstream

- MissionSpec rendering
- compare panel
- graph/runtime topology panel
- workspace section rebalance
- session search/archive
- patch review improvements
- attachment preview

Primary modules:

- [`apps/mobile/app/tasks/index.tsx`](/C:/project/my-mate/apps/mobile/app/tasks/index.tsx)
- [`apps/mobile/app/tasks/[sessionId].tsx`](/C:/project/my-mate/apps/mobile/app/tasks/[sessionId].tsx)
- [`apps/mobile/lib/api.ts`](/C:/project/my-mate/apps/mobile/lib/api.ts)
- [`apps/mobile/lib/task-thread.ts`](/C:/project/my-mate/apps/mobile/lib/task-thread.ts)
- [`apps/mobile/lib/types.ts`](/C:/project/my-mate/apps/mobile/lib/types.ts)

### Studio workstream

- MissionSpec desktop panel
- compare panel
- graph view
- workspace rebalance
- session search/archive controls
- command palette
- file preview rail
- dashboard and future canvas

Primary modules:

- [`apps/studio/src/app.js`](/C:/project/my-mate/apps/studio/src/app.js)
- [`apps/studio/src/styles.css`](/C:/project/my-mate/apps/studio/src/styles.css)

### Test and acceptance workstream

- CP app tests
- gateway passthrough tests
- mobile thread and mission snapshot tests
- Studio smoke checks
- targeted acceptance scripts for runtime patch and workspace rendering

Primary modules:

- [`services/control-plane/test/app.test.ts`](/C:/project/my-mate/services/control-plane/test/app.test.ts)
- [`services/api-gateway/test/app.test.ts`](/C:/project/my-mate/services/api-gateway/test/app.test.ts)
- [`apps/mobile/test/task-thread.test.ts`](/C:/project/my-mate/apps/mobile/test/task-thread.test.ts)
- acceptance artifacts under [`tmp`](/C:/project/my-mate/tmp)

## Exit Criteria For The Next Iteration

The next iteration should be considered successful when all of the following are
true:

1. the visible product reads as a Mission workspace first
2. a user can compare route or revision changes explicitly
3. a user can inspect current runtime topology without reading raw event logs
4. outputs, checkpoints, and pipelines are visible as persistent product
   surfaces
5. the next iteration leaves a clear runway for full runtime steering and
   broader desktop ergonomics

That is the right threshold for the next step toward Hermes-class desktop
usability without losing My Mate's core orchestration focus.
