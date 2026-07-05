# Studio V2 Orchestrator Workbench

This document resets Studio around the intended product direction:

> My Mate Studio should be a Hermes Desktop-plus workbench for hosting and
> supervising a conversation-first orchestrator.

The orchestrator is the main actor. It talks with the user, understands the
mission, chooses a model/provider strategy, proposes a DAG, assigns subagents,
and supervises execution until the requested deliverables are produced.

## Product Intent

Studio V1 drifted into a broad control panel. It exposed useful primitives:

- missions and sessions
- templates and DAG authoring
- registry and agent hosting
- runtime graph and route compare
- command palette and attachments

But the user experience is not clear enough. The primary screen should no
longer ask the user to understand every internal object first.

Studio V2 keeps a dedicated orchestrator workspace, but the primary desktop
shell now reads as a mission workspace first. When mission inventory exists,
Studio lands in `Missions`; when it does not, Studio falls back to
`Orchestrator` so the user can start from plain language.

1. Open an active mission or start a new one in `Orchestrator`.
2. Pick or configure the orchestrator.
3. Choose provider/model intent.
4. Describe the mission in conversation.
5. Let the orchestrator draft MissionSpec and DAG.
6. Review subagent assignments.
7. Confirm and run.
8. Track execution and outputs.

## Target IA

### Left Rail

- Orchestrator
- Missions
- Sessions
- Subagents
- Templates
- Registry
- Settings

The left rail is for switching context, not for understanding the workflow.
The default landing route is `Missions` when a mission is available; otherwise
Studio falls back to `Orchestrator`.

### Center

The center is chat-first:

- active mission brief
- orchestrator conversation
- user instruction composer
- MissionSpec summary
- DAG proposal
- execution handoff status

The user should be able to start from plain language and never open the
template editor unless they want to.

### Right Rail

The right rail is the cockpit:

- selected orchestrator profile
- provider/model intent
- system prompt summary
- default subagents
- DAG node assignments
- runtime health
- generated outputs and attached context

## Core Domain Model

### OrchestratorProfile

Needed as a first-class backend object.

Fields:

- `orchestrator_id`
- `name`
- `provider`
- `model`
- `system_prompt`
- `default_tools`
- `default_subagent_profile_ids`
- `planning_policy`
- `handoff_policy`
- `metadata`

Current implementation:

- planner provider/model from runtime summary
- agent profiles from registry
- persisted Control Plane orchestrator profiles
- Gateway proxy routes for orchestrator profile CRUD
- Studio create/update/select controls
- planner endpoints resolve selected orchestrator profile into request-level
  provider/model/system prompt context
- Claude API planner consumes persisted profile model in its SDK call and adds
  persisted system prompt as bounded planner guidance

### MissionSpec

Already exists as a durable projection. V2 treats it as the orchestrator's
contract before DAG proposal.

### DagProposal

Needed as the orchestrator-visible proposal object.

Current approximation:

- planner candidate plan
- DAG draft
- route compare summary

### SubagentAssignment

Each DAG node needs an inspectable assignment:

- node id/name
- subagent profile
- provider/model override
- allowed tools
- input context
- output contract

Current approximation:

- compiled DAG nodes
- registry-aware planner recommendations

## V2 Workstreams

### V2.1 Studio IA Reset

Status: Done

Tasks:

- [x] Keep `Orchestrator` as a first-class Studio route for mission creation.
- [x] Replace control-panel first screen with chat-first workbench.
- [x] Move old management surfaces behind secondary nav.
- [x] Keep existing Mission Workspace, Templates, Registry, and Settings reachable.

Definition of done:

- Opening Studio makes the mission/orchestrator workflow obvious without
  reading docs.

Acceptance note (2026-06-29):

- `apps/studio/src/app.js` originally booted V2 with
  `activeNav: "orchestrator"` and routed the default desktop workspace into
  `renderOrchestratorWorkbench()`.
- The dedicated `Orchestrator` route remains a chat-first workbench with:
  - `Start Here` launchpad
  - mission conversation feed
  - mission instruction composer
  - compact `MissionSpec`
  - `DAG Proposal`
  - conditional `Execution Cockpit`
- Existing management surfaces remain reachable from the primary left rail:
  - `Missions`
  - `Sessions`
  - `Templates`
  - `Registry`
  - `Settings`
- The right rail stays focused on orchestration and supervision instead of the
  old control-panel-first layout.

Current alignment note (2026-07-03):

- `apps/studio/src/app.js` now boots with `activeNav: "missions"` and treats
  `Orchestrator` as a dedicated mission-shaping surface rather than the
  default landing route.
- Mission loading falls back to `Orchestrator` when no mission is available,
  which matches the newer Studio smoke check in `apps/studio/scripts/check.mjs`
  and the Mission-workspace-first acceptance artifacts captured on
  2026-07-03.

### V2.2 Orchestrator Profile Backend

Status: Done

Tasks:

- [x] Add Control Plane `OrchestratorProfile` store.
- [x] Add Gateway routes.
- [x] Add Studio create/update/select controls.
- [x] Connect profile provider/model/system prompt to planner endpoint execution.
- [x] Pass persisted profile model into provider-specific SDK calls where
  supported.

Definition of done:

- Selecting a model in Studio changes the orchestrator/planner behavior through
  persisted backend configuration, not only local UI state.

### V2.3 DAG Proposal And Subagent Review

Status: Done

Tasks:

- [x] Promote planner candidate plan and DAG draft into a first-class proposal
  surface in the Orchestrator Workbench.
- [x] Render subagent assignments before run confirmation.
- [x] Allow inline edits to assignment/model/tool intent before dispatch.
  Current behavior: proposal cards support inline edits for subagent, skills,
  tools, provider, model, input context, and output contract before copying or
  saving the proposal into the template editor flow.

Definition of done:

- The user can see who will do each part of the work before execution starts.

### V2.4 Execution Cockpit

Status: Done

Tasks:

- [x] Merge runtime graph, intervention surfaces, artifacts, and attachments
  into a single execution cockpit in the Orchestrator Workbench.
- [x] Keep final outputs visible as deliverables, not raw artifact cards.
- [x] Add direct runtime intervention controls instead of read-only operator
  supervision cards.
- [x] Replace the temporary raw JSON human-input submit box with a richer
  schema-driven control surface.

Definition of done:

- Running work reads like supervised multi-agent execution rather than a log.

Acceptance note (2026-06-29):

- Host-level UI acceptance completed against live local services on:
  - `http://127.0.0.1:4010`
  - `http://127.0.0.1:4030`
  - `http://127.0.0.1:5174`
- Verified in the real Studio page:
  - Execution Cockpit renders runtime graph, context files, deliverables, and
    interventions/gates in one workspace.
  - A runtime intervention can be submitted from the cockpit and flows back into
    the mission thread and supervision rail.
  - A newly created patch proposal reaches a reviewable state and can be
    rejected from the cockpit, with the rejected status reflected in the UI.
- Acceptance artifacts captured under:
  - `tmp/ui-acceptance/studio-home.png`
  - `tmp/ui-acceptance/ui-demo-runtime-adjustment.png`
  - `tmp/ui-acceptance/ui-demo-after-intervention-submit.png`
  - `tmp/ui-acceptance/ui-demo-after-patch-reject.png`
- During acceptance, a cockpit interaction bug was found and fixed:
  - `Runtime Intervention` input changes now trigger re-render so the
    `Record intervention` button correctly leaves the disabled state once
    content is present.

Acceptance note (2026-07-03):

- Main local services were switched to the real OpenClaw bridge path:
  - Control Plane: `http://127.0.0.1:4010`
  - API Gateway: `http://127.0.0.1:4030`
  - OpenClaw bridge: `http://127.0.0.1:4020`
  - Studio: `http://127.0.0.1:5174`
- Runtime summary verified:
  - `adapter_kind: openclaw`
  - `local_execution_enabled: false`
  - `bridge_execution_mode: container-exec`
- A full proposal-confirm-run business flow completed through OpenClaw:
  - `session_id: sess_20260703T024056243Z_000_uu303u`
  - `proposal_id: prop_20260703T024056353Z_000_kbmqsh`
  - `run_id: run_20260703T024056453Z_000_o08abz`
  - `dispatch_id: disp_20260703T024056552Z_000_2cjuti`
  - run status: `completed`
  - dispatch status: `completed`
  - returned artifacts: `agent-report`, `handoff`
- Studio now surfaces the confirmed proposal trace in the mission workspace:
  - proposal id
  - proposal status
  - execution template
  - assignment count
  - confirmation actor/time
- `/api/sessions/:sessionId/compare` now returns `200 null` for default
  no-route sessions instead of logging a browser 404; explicit invalid compare
  selectors still return errors.
- Added operational scripts:
  - `scripts/start-main-openclaw.mjs` now avoids stale PID writes when a service
    is already listening and supports explicit `--restart`.
  - `scripts/main-openclaw-proposal-e2e.mjs` runs the main proposal-confirm-run
    OpenClaw regression and writes evidence under
    `tmp/main-openclaw-proposal-e2e/`.
- Latest automated evidence:
  - `tmp/main-openclaw-proposal-e2e/20260703T024056189Z/summary.json`
  - `tmp/main-openclaw-proposal-e2e/20260703T024056189Z/observations.json`
  - `tmp/playwright-work/openclaw-e2e-output/studio-proposal-trace-visible.png`
  - `tmp/playwright-work/openclaw-e2e-output/studio-proposal-trace-visible.json`

### Acceptance Evidence

Environment:

- Control Plane: `http://127.0.0.1:4010`
- API Gateway: `http://127.0.0.1:4030`
- Studio: `http://127.0.0.1:5174`

Captured artifacts:

- Studio landing/workbench:
  - `tmp/ui-acceptance/studio-home.png`
  - `tmp/ui-acceptance/studio-home.txt`
- Runtime session view:
  - `tmp/ui-acceptance/ui-demo-runtime-adjustment.png`
  - `tmp/ui-acceptance/ui-demo-runtime-adjustment.txt`
- Runtime intervention submission:
  - `tmp/ui-acceptance/ui-demo-after-intervention-submit.png`
  - `tmp/ui-acceptance/ui-demo-after-intervention-submit.txt`
- Patch rejection flow:
  - `tmp/ui-acceptance/ui-demo-after-patch-reject.png`
  - `tmp/ui-acceptance/ui-demo-after-patch-reject.txt`

Verified outcomes:

- The Orchestrator workbench loads with the execution cockpit visible in the
  center workflow.
- The runtime session `UI Demo Runtime Adjustment Walkthrough` renders:
  - runtime graph
  - deliverables ledger
  - context files section
  - interventions and gates backlog
  - supervision-first right rail
- A runtime intervention submitted from the cockpit is persisted and reflected
  in:
  - the mission thread
  - the center execution queue
  - the right-rail supervision surfaces
- A fresh patch proposal created from the cockpit reaches a reviewable state,
  exposes enabled `Confirm patch` / `Reject patch` actions, and can be rejected
  through the real UI.

## Immediate First Slice

This slice should stay frontend-heavy and reuse current APIs:

- default Studio route becomes `orchestrator`
- center shows orchestrator chat/workbench
- right rail shows model intent, planner runtime, DAG/subagent preview
- old surfaces stay reachable

Connecting persisted orchestrator profiles into planner/orchestrator execution
is the next slice.

## Current Implementation Audit

Last checked: 2026-07-03

### Done

- Studio state now defaults to `activeNav: "orchestrator"`.
- The default center surface is an orchestrator workbench with:
  - active mission title and status
  - orchestrator/user conversation feed
  - mission instruction composer
  - MissionSpec compact summary
  - DAG proposal preview from current planner candidate/draft data
- The right rail has local orchestrator setup controls for profile, provider,
  model, and system prompt.
- Control Plane now persists `OrchestratorProfile` records under the data root.
- Gateway now proxies orchestrator profile list/get/upsert routes.
- Studio now loads and saves persisted orchestrator profiles from the
  Orchestrator Setup rail.
- Studio planner actions now send the selected orchestrator profile into
  planner endpoints.
- Studio session creation now persists the selected orchestrator profile so
  session-native orchestration reuses the same planner identity.
- Planner endpoints now use selected profile provider as request-level planner
  provider intent and annotate planner context with profile id, model, and
  system prompt.
- Claude API planner now uses selected profile model for `messages.create` and
  includes selected profile system prompt as lower-priority template-selection
  guidance.
- Session-native DAG draft, plan, revise, and run fallback planning now resolve
  planner provider/model/system prompt from the persisted session
  `orchestrator_profile_id`.
- Orchestrator Workbench DAG Proposal now exposes actions to copy or save
  generated planner output as an editable template draft.
- Orchestrator Workbench DAG Proposal cards now support inline assignment
  overrides for subagent, skills, tools, provider/model intent, input context,
  and output contract before draft adoption.
- Orchestrator Workbench now includes an execution cockpit with runtime graph,
  context files, deliverable ledger, and approvals/interventions backlog in the
  same center workflow.
- Execution cockpit now supports direct operator actions for run
  pause/resume/cancel, approval approve/reject, human-input submit, runtime
  intervention creation, and DAG patch confirm/reject.
- Human-input requests in the execution cockpit now render schema-driven fields
  for enums, booleans, numeric input, and multiline text instead of requiring
  raw JSON entry.
- The Orchestrator right rail now emphasizes supervision state, latest outputs,
  and pending execution gates ahead of raw runtime metadata.
- The right rail also surfaces subagent readiness and planner/runtime summary
  from existing runtime APIs.
- Existing Missions, Sessions, Subagents, Templates, Registry, and Settings
  surfaces remain reachable from the left navigation.
- The command palette includes navigation into the V2 orchestrator workbench and
  secondary surfaces.
- Conversation start/follow-up uses the existing session APIs:
  - `POST /api/sessions`
  - `POST /api/sessions/:sessionId/messages`
- DAG generation and route planning reuse the existing planner endpoints:
  - `POST /api/planner/dag-draft`
  - `POST /api/planner/template-selection`
  - `POST /api/planner/candidate-plan`

### Partial

- Persisted profile provider now changes planner provider selection when it
  matches a registered provider id. Claude consumes persisted model/system
  prompt; rule-based/local semantic providers record them in context but do not
  otherwise need SDK-level consumption.
- Session-native orchestration now inherits a persisted orchestrator profile
  only when the session was created with a saved profile id. Unsaved draft
  provider/model/system prompt edits remain Studio-local and still do not
  propagate through session APIs.
- Studio now uses the durable `DagProposal` API for the Orchestrator Workbench
  proposal surface: it loads session proposals, creates proposal records,
  persists assignment edits, confirms proposals, and launches runs with
  `proposal_id`.
- A live browser E2E pass against Studio, API Gateway, and Control Plane passed
  on 2026-06-30. The pass also fixed two Studio race conditions: proposal field
  edits no longer re-render before the save click lands, and stale workspace
  loads no longer overwrite the active newly-created mission.
- Mobile run summaries, run follow-up, and mission overview surfaces now show
  durable `proposal_id` backlinks.
- Runtime patch review now includes graph preview/history summaries. Control
  Plane persists `DagPatchRecord.graph_preview`, Mobile patch cards show the
  predicted/actual topology impact, and Studio execution queue/right rail show
  the same preview before a full graph editor exists.
- Studio Execution Cockpit now has a dedicated `Patch Graph Review` panel for
  the latest previewable patch, comparing current, predicted, and actual
  topology snapshots.
- Main Studio/OpenClaw proposal-confirm-run flow is covered by
  `scripts/main-openclaw-proposal-e2e.mjs`.
- Studio OpenClaw projection is now covered by
  `apps/studio/scripts/openclaw-visual-acceptance.mjs`, and the combined
  backend-plus-Studio release gate is orchestrated by
  `scripts/main-openclaw-studio-acceptance.mjs`.
- Mission deep links now restore the target session workspace before the larger
  mission/session inventories finish loading, so large local histories do not
  block visual acceptance of a specific run.
- The main startup helper is restart-aware and no longer overwrites PID evidence
  when the target service is already listening.
- Mission and Orchestrator workspaces show the active confirmed proposal trace
  next to the route/DAG surfaces.

### Not Done

- Full visual runtime graph editing/canvas interactions, broader
  `DagPatchRecord` redesign, MissionSpec rewrite, and broader mobile shell
  migration remain separate future slices.
