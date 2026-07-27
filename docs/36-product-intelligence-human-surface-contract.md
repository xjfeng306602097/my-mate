# Product Intelligence And Human Surface Contract

Status: active implementation contract
Stage: `PX-00 -> PX-08`
Last updated: 2026-07-13

## Objective

My Mate already has a broad machine-side platform: Mission planning, DAG
execution, Agent Harnesses, Docker Workers, evidence, evaluation, replay,
recovery, governance, and observability. The next product stage narrows the
human side without removing those capabilities.

The default product must let a person reason about only three things:

1. **Task**: what outcome is requested.
2. **Decision**: what needs human judgement now.
3. **Result**: what was produced and whether it is trustworthy.

Everything else is system implementation detail or an optional technical
drilldown.

## Human Surface Contract

### Default human concepts

The primary UI may directly expose:

- Task
- Inbox item
- Result or deliverable
- Current progress
- Required decision
- Cost or risk when it changes a decision
- Model connection and machine readiness in Settings

### Progressive-disclosure concepts

These concepts remain available, but must not be required for a normal task:

- Session and Run identifiers
- DAG nodes, ports, and edge conditions
- Agent Profiles, Subagents, and Harness profiles
- Templates and Registry records
- Dispatcher, Provisioner, Worker, and container identity
- Scorecard, Evaluation, Replay, and Trace records
- Protocol, credential environment variable, and provider implementation ID

They belong under `Advanced`, `Operations`, or task-level technical details.

### Never-hide truth

Simplification must not remove:

- approval and human-input requirements
- material cost, permission, or destructive-operation risk
- provider verification failures
- incomplete or unavailable evidence
- quality failures and recovery exhaustion
- immutable audit, trace, and replay access

The product hides vocabulary and low-level controls, not risk or evidence.

## Information Budget

Every default surface follows these limits:

- one primary action per stage
- no more than three primary status signals above the fold
- no empty technical panels
- no raw IDs unless they are necessary to support or audit the task
- no configuration field that can be deterministically derived
- no question unless the answer changes execution, risk, cost, or output

Secondary actions use menus, details, or an Advanced surface.

## Default Navigation

The primary Studio navigation is:

1. `Tasks`: create, continue, and review tasks.
2. `Inbox`: approvals, human input, failures, and blocked decisions.
3. `Library`: reusable workflows and completed deliverables.
4. `Settings`: model, machine readiness, and workspace identity.

The navigation is grouped by user intent:

- `Task`: Tasks, Scheduled, Inbox, and Settings
- `Build`: Agents, Workflow Library, Workflow Editor, and Registry
- `Operate`: Mission Workspace, Runtime Dashboard, and Memory
- `Admin`: System Details and diagnostic controls

Sessions remain available as an internal view inside Mission Workspace. Existing route IDs and deep links remain compatible during migration.


## Task Flow

The default flow is:

```text
describe outcome
  -> system derives MissionSpec, route, model, and agents
  -> system asks only blocking clarification
  -> user confirms one recommended action when needed
  -> system executes and supervises
  -> Inbox contains only decisions and exceptions
  -> result view leads with deliverables and quality
```

The initial task surface must not ask the user to choose between `Start`,
`Generate DAG`, and `Plan`. The single primary action is `Start task` or the
stage-specific next action supplied by the Mission Workspace contract.

## Setup Autopilot Contract

Normal setup exposes only:

- Provider
- Model
- Endpoint when the provider requires it
- API key

The system derives runtime, protocol, provider ID, credential environment, and
Connection name. `Save & verify` performs this ordered workflow:

1. save the encrypted Provider Connection
2. create or repair the default Agent Profile binding
3. send the explicit minimal Connection test
4. persist `verified` or `failed`
5. run host-shell and Docker environment checks
6. show one next repair action when a required check fails

Advanced Connection settings remain available as an escape hatch.

## Trust And Autonomy

Future autonomy levels must be expressed as user policy rather than runtime
configuration:

- `Review first`: confirm important execution transitions
- `Assisted`: confirm risk, cost, permission, and ambiguous outcomes
- `Autopilot`: proceed inside explicit policy and budget boundaries

The recommended default is `Assisted`.

## Stage Plan

### PX-00 Human Surface Contract

- define the allowed default concepts and progressive-disclosure boundary
- define the information budget and single-primary-action rule
- make the contract part of the active product roadmap

### PX-01 Smart Shell And Navigation

- make Tasks the default Studio surface
- reduce primary navigation to Tasks, Inbox, Library, and Settings
- keep operational and authoring tools under Advanced
- remove the three-step explanatory launchpad and duplicate task actions
- render Inbox from real pending approval and human-input APIs

### PX-02 Setup Autopilot

- preserve the minimal provider form
- change the primary action to explicit `Save & verify`
- test the saved Connection through the dedicated endpoint
- bind or repair the default Agent Profile
- display `Configured`, `Verified`, and `Failed` honestly
- run environment checks automatically after successful verification

### PX-03 One-Action Task Advance

- derive one recommended action from the current task state
- let `Start work` advance through the existing Session message contract
- preserve strict runtime validation and never translate a business-level
  refusal into a successful start notification
- keep task conversation available as secondary context

### PX-04 Adaptive Task Surface

- derive a stable human phase from Session, Run, decision, result, route, and
  transition evidence
- render `ready`, `running`, `decision`, `result`, `recovery`, and preparation
  states without exposing runtime vocabulary
- lead completed tasks with returned deliverables
- collapse conversation, plan, runtime graph, trace, replay, and evidence until
  the current state or the user asks for them

### PX-05 Proactive Supervision

- prioritize pending approvals and human input over passive progress
- surface failed transitions, stale routes, stopped Runs, and missing evidence
  as an explicit next action
- limit the default status strip to progress, decisions, and results
- use the same derived state for the task header and primary workspace so raw
  `planning`, `Unrouted`, and other technical labels do not leak into the
  normal flow

### PX-06 Human Autonomy Policy

- expose `Review first`, `Assisted`, and `Autopilot` as the only normal
  autonomy choices
- persist the selected workspace policy on `default-agent` metadata while
  retaining a local Studio preference during first-run setup or governed
  Registry review
- make `Review first` lead to plan review instead of execution
- allow `Autopilot` to auto-advance only when a model is verified, the task is
  in a routine ready state, and strict validation and human gates remain active

### PX-07 Exception Repair Guidance

- translate provider, workflow, validation, stale-plan, transition, and stopped
  Run failures into one concrete repair action
- route repairs to existing Settings, Library, plan review, conversation, or
  runtime recovery capabilities
- prioritize missing prerequisites before downstream repairs
- preserve the original failure evidence and technical drilldown

### PX-08 Result Trust Guidance

- present result quality as `Not checked`, `Checking`, `Partially checked`,
  `Review needed`, or `Trusted`
- never mark a result trusted from a successful Run alone
- require both a passing pipeline Scorecard and passing independent quality and
  evidence Evaluation before displaying `Trusted`
- offer one `Check quality` action that records both checks through existing
  runtime APIs

## Acceptance Criteria

- A configured user can start a task with one text submission.
- The default navigation contains no Session, Run, Registry, Harness, or Worker
  concepts.
- A normal model setup does not expose protocol or credential environment.
- A saved model is not called ready until the live Connection test passes.
- Every blocked state presents a concrete next action.
- Existing advanced routes, audit evidence, and operational controls remain
  reachable.
- Desktop and narrow viewport checks show no overlap or clipped primary text.

## Non-Goals

This stage does not remove runtime capabilities, rewrite Mission persistence,
or replace deterministic planning fallback. Voice input and fully generated UI
widgets are later product-intelligence stages after the default shell is
stable.
