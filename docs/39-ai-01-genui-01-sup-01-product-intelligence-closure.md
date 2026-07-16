# AI-01, GENUI-01, And SUP-01 Product Intelligence Closure

Status: complete
Scope: `SUP-01`, `AI-01`, `GENUI-01`
Verified: 2026-07-13

## Shared Architecture

The three initiatives share server-side truth instead of independent Studio
heuristics:

```text
Run / Session / gates / evaluation / provider truth
  -> Proactive Supervisor
  -> durable Supervision Alerts
  -> Session Autopilot Controller
  -> versioned Mission UI Plan
  -> Studio component registry
```

All persisted records use the existing JSON storage backend abstraction and
are included automatically in storage export/import snapshots. Gateway routes,
OpenAPI schemas, generated shared types, and request audit middleware cover the
new APIs.

## SUP-01 Proactive Supervision

The production watchdog and explicit `POST /api/supervision/scan` detect:

- missing verified default Provider Connection
- pending approval or human input
- stalled queued/running Run
- failed or cancelled Run
- completed Run without complete passing quality evidence
- blocked or failed Autopilot handoff

Alerts use stable fingerprints. Repeated scans update `last_seen_at` and
`occurrence_count` instead of creating duplicates. Conditions no longer found
are resolved automatically; users may also resolve an alert explicitly.

Studio loads alerts into Inbox and the active Task. Each alert carries one
recommended existing product action and preserves its category, severity,
Run/Session identity, timestamps, occurrence count, and metadata.

## AI-01 Orchestrator Autopilot

Each Session may have one durable controller:

- policy mode: Review first, Assisted, or Autopilot
- status and phase
- iteration and runtime limits
- started, paused, completed, last-tick, and next-tick timestamps
- last action/detail, human handoff reason, and bounded history

The state machine performs one auditable step per tick:

```text
check limits and prerequisites
  -> wait for required human gates
  -> require verified default model
  -> create strict Run from Session context
  -> supervise queued/running work
  -> retry one failed node only inside its retry policy
  -> create/reuse pipeline Scorecard
  -> create/reuse deterministic independent Evaluation
  -> complete only when quality/evidence pass
  -> otherwise hand control back with reason
```

Pause, resume, configure, inspect, and manual tick APIs are available. The
production watchdog continues controllers in `ready` or `running` state only.
Review first and Assisted never start work in the background.

## GENUI-01 Adaptive Mission Workspace

Control Plane emits `MissionUiPlan` version 1 from current task truth. It may
reference only these registered components:

- task guidance
- decision queue
- progress summary
- result gallery
- quality summary
- repair recommendation
- conversation
- technical details

No arbitrary markup, script, style, or component path crosses the API. Studio
maps identifiers through a local registry, de-duplicates blocks, skips unknown
components, and injects Task Guidance when no safe primary block is present.
Technical details remain `advanced` in every generated plan.

## API Surface

- `GET /api/supervision/alerts`
- `POST /api/supervision/scan`
- `POST /api/supervision/alerts/{alertId}/resolve`
- `GET /api/sessions/{sessionId}/autopilot`
- `PUT /api/sessions/{sessionId}/autopilot`
- `POST /api/sessions/{sessionId}/autopilot/tick`
- `POST /api/sessions/{sessionId}/autopilot/pause`
- `POST /api/sessions/{sessionId}/autopilot/resume`

Session Workspace responses and stream snapshots include `supervision_alerts`,
`autopilot`, and `ui_plan`.

## Verification

- Control Plane and API Gateway TypeScript checks pass.
- OpenAPI generated shared types are current.
- Focused Control Plane tests pass for alert deduplication, strict Autopilot
  Run creation, controller persistence, and whitelist-only UI Plan generation.
- Full API Gateway suite passes with explicit new-route coverage.
- Studio syntax, interaction, task-intelligence, and layout checks pass.
- Browser acceptance covers generated repair blocks, alert Inbox, Autopilot
  controls, desktop layout, 390 x 844 responsive behavior, and console errors.
