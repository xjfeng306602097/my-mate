# Product Intelligence Adaptive Task Closure

Status: complete
Scope: `PX-03`, `PX-04`, `PX-05`
Verified: 2026-07-13

## Objective

Move the normal Tasks experience from a conversation-led technical workspace
to a state-aware product surface. A user should see what is happening, whether
they are needed, what result exists, and one recommended action without having
to understand Session, Run, DAG, or orchestration concepts.

## Architecture

`apps/studio/src/task-guidance-model.js` is a pure projection layer. It accepts
the existing Mission Workspace detail and derives:

- human phase and tone
- status label, title, and explanatory detail
- progress, decision, and result signals
- zero or one primary action
- the audited Session directive for actions that advance work

The projection does not mutate runtime state and does not replace Control Plane
validation. Actions continue through existing APIs:

```text
Task Guidance action
  -> Session message contract
  -> planner / route / strict Run validation
  -> reload Mission Workspace truth
  -> derive the next human phase
  -> show success only when the derived phase proves advancement
```

## Human Phases

| Phase | Trigger | Human action |
|---|---|---|
| Ready | task exists without an active or terminal Run | Start work |
| Running | queued, provisioning, dispatching, or running | View progress |
| Paused | runtime is paused | Review pause |
| Decision | approval, human input, waiting-human, or blocked state | Review decision |
| Result | successful terminal state | Review results or evidence |
| Recovery | failed, cancelled, or timed-out state | Review recovery |
| Preparation | stale route or failed transition | Update plan or review details |

Decision state has higher priority than running state. This ensures the system
interrupts the user only when work cannot safely proceed without judgement.

## Progressive Disclosure

The first screen contains Task Guidance and, when available, returned results.
Task conversation, plan details, runtime graph, artifacts, evaluation, trace,
and replay remain available in collapsed detail regions. The simplification
changes presentation, not persistence or auditability.

## Verification

- Studio syntax and interaction checks pass.
- Six focused Task Guidance tests cover decision priority, running progress,
  completed results, stale routes, ready advancement, and transition failure.
- Desktop browser interaction confirms one recommended action and expandable
  contextual details with no console errors.
- A real local `Start work` action in an environment with no published
  templates returns `Needs attention / no published templates`; no false start
  success is displayed.
- A 390 x 844 browser viewport has no page-level horizontal overflow and shows
  one visible Task Guidance primary action.
