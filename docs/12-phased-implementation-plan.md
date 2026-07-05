# My Mate Phased Implementation Plan

This document turns the conversation-first redesign into an executable staged plan.

It answers one practical question:

what should be built in each phase so the product moves steadily from the current mobile MVP toward a mission-first orchestrator product on top of OpenClaw?

It builds on:

- [`docs/08-current-status-and-next-steps.md`](/C:/project/my-mate/docs/08-current-status-and-next-steps.md)
- [`docs/09-conversation-first-orchestrator-redesign.md`](/C:/project/my-mate/docs/09-conversation-first-orchestrator-redesign.md)
- [`docs/10-bilibili-reference-video-review.md`](/C:/project/my-mate/docs/10-bilibili-reference-video-review.md)
- [`docs/11-openclaw-conversation-product-implementation.md`](/C:/project/my-mate/docs/11-openclaw-conversation-product-implementation.md)
- [`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)

## Phase Design Principles

The phases are intentionally shaped to protect the current working runtime while changing the product shell.

Rules:

1. Keep OpenClaw as execution substrate.
2. Do not rewrite the current run engine before adding the session shell.
3. Change the user-facing product object from `Run` to `Mission`, with `Session` retained as the conversation rail inside that Mission.
4. Only add dynamic DAG mutation after the session loop exists.
5. Keep each phase independently demonstrable.

## Current State Note

The repository has already implemented most of the historical Phase 1, Phase 2,
and Phase 2.5 foundations:

- Session exists
- planning and execution can already be projected into the thread
- orchestrator interpretation on message append exists
- runtime intervention capture and partial patch application exist

That changes the next planning problem.

The next active slice is no longer "make the thread slightly nicer".

It is:

- lift the existing Session foundation into a Mission workspace shell
- add a durable MissionSpec above revisions and runs
- keep conversation as a rail, not the whole product shell

## Phase 1: Session Foundation

### Goal

Create the missing product shell:

- `Session`
- `SessionMessage`
- task thread APIs

At the end of this phase, the product should still use the existing planner and run engine, but the user-facing interaction should already stop being “just create a run from a form”.

### Backend scope

Add to control-plane:

- `SessionRecord`
- `SessionMessageRecord`
- file-backed session store
- file-backed session message store

Add APIs:

- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `GET /api/sessions/:sessionId/messages`
- `POST /api/sessions/:sessionId/messages`

Suggested message kinds for Phase 1:

- `text`
- `system`
- `plan_card`
- `run_card`

Suggested session statuses:

- `draft`
- `planning`
- `ready_to_run`
- `running`
- `waiting_human`
- `completed`
- `failed`
- `cancelled`

### Mobile scope

Add:

- `New Task` entry
- task thread screen
- message list UI
- composer UI

Keep existing screens for now:

- home
- inbox
- runs
- run detail

But the new task thread becomes the preferred entry for new work.

### Planner / orchestrator scope

In this phase, do **not** build a new LLM orchestrator yet.

Instead:

- wrap existing planner endpoints
- write planner output into Session messages
- allow Session to create a Run after plan confirmation

### OpenClaw scope

No protocol changes required.

Reuse existing:

- run creation
- node dispatch
- execution adapter
- callback reports

### Acceptance criteria

1. A user can create a Session from mobile.
2. A user can send at least one natural-language task message.
3. The backend stores the Session and message history.
4. The Session can show planner output as messages or cards.
5. A Session can trigger creation of a real Run.
6. The created Run id is linked back to the Session.

### Not in Phase 1

- runtime DAG mutation
- streaming orchestrator output
- replacing the existing inbox
- replacing existing run detail

## Phase 2: Plan Cards And Session-Linked Execution

### Goal

Make planning and execution appear inside the same task thread.

At the end of this phase, the app should start feeling like:

- the user delegates a task
- the system proposes a plan
- the work continues in the same thread

### Backend scope

Extend Session message kinds:

- `summary_card`
- `registry_warning_card`
- `approval_card`
- `artifact_card`
- `subtask_card`

Add session helpers:

- link Session to one or more Runs
- compute session headline summary
- compute active subtask from linked run state

Add projection logic:

- planner output -> session messages
- run accepted / running / completed -> session messages
- approval requested -> approval card
- human input requested -> human input card
- artifact created -> artifact card

### Mobile scope

Enhance task thread:

- render plan card blocks
- render linked run status inline
- render approvals inline
- render artifacts inline
- render active subtask inline

Add a lightweight expandable execution section:

- linked run ids
- active task
- counts
- quick jump to detailed run view

### Planner / orchestrator scope

Still keep the planner mostly deterministic in this phase, but improve the product layer:

- task understanding summary
- plan proposal card
- risk / validation / registry warnings as readable cards
- explicit confirm-before-run interaction

### OpenClaw scope

No bridge rewrite.

Add a session projection layer above current reports:

- `accepted` -> start message
- `running` -> progress card
- `waiting_human` -> blocker card
- `completed` -> output card
- `failed` -> failure + retry suggestion card

### Acceptance criteria

1. A Session can propose a plan before a run exists.
2. Confirming the plan creates a Run.
3. Once the Run starts, Session messages continue updating automatically.
4. Approval and human-input requests appear in the Session thread.
5. Artifacts appear inline in the Session thread.

### Not in Phase 2

- dynamic DAG patching
- natural-language runtime intervention
- graph diffing
- Studio canvas rewrite

### Phase 2.5: Conversation-Native Thread Shell

This is a product-shell tightening slice that sits after the current Session and
plan-option loop, but before real runtime DAG patching.

Its purpose is to close more of the reference-demo feeling without pretending
that runtime graph mutation already exists.

### Goal

Make the mobile task thread feel like a real orchestrator workspace:

- one continuous orchestrator story
- a visible active work surface
- a reduced dependence on raw operational cards

### Backend scope

Keep current control-plane truth and read-time projection.

Do not introduce runtime patch primitives in this slice.

Add or derive stronger thread-facing projection models:

- `orchestrator_turn`
- `work_package`
- running-stage `intervention_intent` placeholder semantics

These can remain projection-layer objects instead of newly persisted truth in
this phase.

### Mobile scope

Restructure the task thread into three interaction layers:

1. task / orchestrator heading
2. active work package surface
3. raw timeline as secondary evidence

Add:

- inline orchestrator turn stream
- current work package card(s)
- stronger running-stage composer hints
- lighter raw timeline framing

### Planner / orchestrator scope

Still deterministic.

Do not add:

- autonomous DAG synthesis
- LLM planner
- real runtime DAG mutation

Instead, translate current planner and run truth into a more legible product
surface.

### OpenClaw scope

No protocol changes.

Reuse current normalized execution facts and translate them into:

- orchestrator turns
- work package progress
- delivery-oriented thread updates

### Acceptance criteria

1. The thread reads as one orchestrator-led task narrative.
2. The user can see the current active work package without opening raw run detail.
3. The raw timeline remains available, but no longer dominates the experience.
4. Running-stage user input still happens in-thread even before real runtime patching exists.

### Not in Phase 2.5

- runtime add node
- runtime skip branch
- runtime parallelism changes
- pause and resume with real DAG patch application
- graph topology visualization

## Phase 2.75: Mission Workspace Shell

### Goal

Turn the current Session-first shell into a Mission-first shell without throwing
away the Session work that already exists.

At the end of this phase, the user should feel:

- one mission workspace is the product
- conversation is one rail inside it
- runs and evidence are supporting objects inside it

### Backend scope

Add a Mission-shaped read model or projection above current Session truth.

It should be able to hold:

- mission title / objective
- mission status
- current spec summary
- active pipelines
- checkpoints
- latest outputs
- linked sessions and runs

Add or derive a durable `MissionSpec` or equivalent orchestration contract that
can summarize:

- objective
- constraints
- chosen route
- work packages
- expected outputs
- revision lineage

This can begin as a projection layer and does not require a new engine first.

### Mobile scope

Restructure the main task surface into:

1. mission / stage rail
2. central orchestration workspace
3. right-side conversation record
4. bottom floating composer

Promote these into first-class main-surface elements:

- active pipelines
- work packages
- checkpoints
- generated outputs
- runtime snapshots

Keep plan cards, evidence cards, and raw run facts secondary and expandable.

### Planner / orchestrator scope

Do not jump to LLM planner work in this phase.

Instead:

- converge current revisions, options, and workspace truth into a stronger
  MissionSpec summary
- make the orchestrator speak in terms of mission progress and pipeline changes
- keep deterministic planning while the shell changes

### OpenClaw scope

No protocol rewrite is required.

Reuse the current execution path and projection facts.

The change in this phase is product grammar, not execution substrate.

### Acceptance criteria

1. The visible product reads as one Mission workspace, not mainly as a thread.
2. Conversation remains available, but does not dominate the whole surface.
3. The center workspace shows persistent work packages, checkpoints, outputs,
   and snapshots.
4. MissionSpec or equivalent route summary is visible above raw plan cards.
5. Existing Session and Run flows still work underneath the new shell.

### Not in Phase 2.75

- live `add_node` apply
- live `change_parallelism` apply
- `resume_with_patch`
- deep monitoring dashboard
- Studio graph rewrite

## Phase 3: Runtime Intervention And DAG Patching

### Goal

Make the system genuinely dynamic.

At the end of this phase, the user should be able to intervene in natural language and see the plan change.

### Backend scope

Add control-plane patch primitives:

- `add_node`
- `skip_node`
- `insert_branch`
- `replace_agent_binding`
- `change_parallelism`
- `pause_for_replan`
- `resume_with_patch`

Add `PlanRevision` or `DagPatchRecord`:

- `patch_id`
- `session_id`
- `run_id`
- `requested_by`
- `reason`
- `operations`
- `created_at`

Add session message kinds:

- `dag_patch_card`
- `plan_revision_card`

Current first slice already delivered:

- `POST /api/sessions/:sessionId/interventions`
- `SessionInterventionRecord`
- read-time `intervention_card` projection
- gateway passthrough
- mobile runtime composer capture
- explicit runtime intervention audit trail

Current second slice already delivered:

- file-backed `DagPatchRecord`
- intervention-to-patch proposal mapping
- read-time `dag_patch_card` projection
- mobile patch proposal rendering
- `apply_supported = false` until a confirmation/apply endpoint is added

This gives the product an auditable intervention record before the system can safely mutate a live DAG.

### Mobile scope

Add intervention UX:

- reply in thread with instruction
- review “what changed” card
- optionally approve high-risk patch

Suggested intervention examples:

- “先给我文案，不要出图”
- “再加一个竞品参考步骤”
- “这个语气太硬了，换轻一点”
- “这一步先暂停，我确认后再继续”

### Planner / orchestrator scope

Now add a real orchestrator service layer that can:

- interpret intervention language
- propose DAG patch
- explain patch in plain language
- apply patch through control-plane

### OpenClaw scope

Keep OpenClaw node-execution oriented.

Do not ask OpenClaw to become the global planner.

Use OpenClaw as:

- executor for new nodes
- executor after branch changes
- executor after agent-binding swaps

### Acceptance criteria

1. A running Session can accept a natural-language intervention.
2. The backend can convert it into one or more DAG patch operations.
3. The control-plane can apply the patch safely.
4. The Session thread shows what changed.
5. Subsequent OpenClaw execution reflects the revised plan.

### Not in Phase 3

- full graph canvas
- production multitenancy

## Phase 4: Presence And Rich Orchestration

### Goal

Move from a capable task thread to a product that feels truly agentic and low-friction.

### Backend scope

Add:

- streaming session events
- richer orchestrator summaries
- draft comparison outputs
- better artifact grouping
- optional LLM-based planner

### Mobile scope

Add:

- streaming assistant updates
- richer artifact preview cards
- proactive notifications
- better inline compare / review interactions

### Planner / orchestrator scope

Add:

- LLM-based task decomposition
- smarter registry-aware recommendation
- cost / time / confidence aware replanning
- multi-branch candidate evaluation

### OpenClaw scope

Selective enhancements only:

- richer structured report extraction
- better waiting_human signaling
- better node-level summary extraction

Do not over-couple product semantics into OpenClaw internals.

### Acceptance criteria

1. User can start tasks smoothly with text.
2. Orchestrator can stream intermediate updates.
3. User can compare alternatives inside the thread.
4. Session-based product experience feels clearly better than the old run-first flow.

## Parallel Track: Studio

Studio should not block Phases 1-3.

Recommended order:

- Phases 1-3 first for product loop
- Studio graph workbench after runtime patch model is stable

Studio can then build on:

- Session-linked plans
- DAG patch history
- graph revision records

## Parallel Track: Productionization

These are important, but they are not the first product unlock:

- database storage
- RBAC
- multitenancy
- observability dashboard
- SDK generation
- push infrastructure

Treat them as a supporting track, not the center of the next milestone.

## Suggested Engineering Milestones

### Milestone A

Equivalent to Phase 1.

Outcome:

- Session exists
- task thread exists
- Run can be created from Session

### Milestone B

Equivalent to Phase 2.

Outcome:

- task thread shows planning + execution in one place

### Milestone C

Equivalent to Phase 3.

Outcome:

- runtime intervention changes the actual plan

### Milestone B2

Equivalent to Phase 2.5.

Outcome:

- the task thread feels closer to a conversation-native orchestrator workspace
- current work is visible as task work packages, not only as planner/run cards

### Milestone B3

Equivalent to Phase 2.75.

Outcome:

- the exposed product object becomes a Mission workspace
- Session becomes the conversation rail inside that workspace
- MissionSpec exists as a durable orchestration contract above runs and cards
- outputs, checkpoints, and snapshots become first-class product surfaces

### Milestone D

Equivalent to Phase 4.

Outcome:

- product feels close to the reference demo

## Recommended Immediate Start

If starting from zero historically, Phase 1 was the correct first slice.

For the current repository state, the next active slice is **Phase 2.75**.

Why:

- the Session foundation already exists
- the next correction is product-shell level, not another round of thread polish
- it reuses the current control-plane and OpenClaw path
- it prepares the right surface for the remaining P2 runtime work

## Phase 1 Implementation Checklist

1. add `SessionRecord` and `SessionMessageRecord` types
2. add session stores
3. add session APIs in control-plane
4. add API gateway proxy rules for session endpoints
5. add mobile task thread route and basic UI
6. add “create session” and “send message” flow
7. add planner projection into session messages
8. add “confirm and create run” flow linked to session
9. add focused tests for session storage and session API

That is the right first slice.
