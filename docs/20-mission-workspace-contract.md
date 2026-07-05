# Mission Workspace Contract

This document defines the formal `Mission Workspace` contract used by My Mate
during the `MW-00` contract-normalization and `MW-01` workspace-structure
phases.

It is the implementation companion to:

- [`docs/19-progress-tracking-checklist.md`](/C:/project/my-mate/docs/19-progress-tracking-checklist.md)

## Scope

This contract applies to the primary workspace truth returned from:

- `GET /api/missions/:sessionId`
- `GET /api/sessions/:sessionId`

The current top-level workspace object remains:

- `mission_snapshot`

The current explicit version marker is:

- `workspace_contract_version`

Current stabilized version:

- `1`

## Contract Rules

1. `mission_snapshot` remains the single formal workspace object for this
   iteration.
2. `workspace_contract_version` must be present whenever primary workspace truth
   is returned.
3. The `Control Plane` owns construction of the primary workspace truth.
4. Mobile and Studio may adapt presentation, but must not recompute primary
   Mission semantics from raw thread/cards/run graph as a replacement for the
   contract.
5. Temporary compatibility fields may exist during migration, but new semantic
   meaning must be interpreted through the versioned contract.

## Top-Level Fields

Required fields in `mission_snapshot`:

- `workspace_contract_version`
- `missionTitle`
- `missionSummary`
- `missionStatusLabel`
- `missionStatusTone`
- `objective`
- `spec`
- `stages`
- `pipelines`
- `checkpoints`
- `outputs`
- `workspaceSections`
- `artifactSurfaces`
- `nextActionLabel`
- `nextActionDetail`
- `latestUserInstruction`
- `orchestratorReadback`
- `latestOrchestratorReply`
- `activeRouteRevision`
- `activeRouteOption`
- `activeRunId`
- `conversationTurns`
- `evidenceCount`

Allowed nullable fields:

- `objective`
- `nextActionLabel`
- `nextActionDetail`
- `latestUserInstruction`
- `orchestratorReadback`
- `latestOrchestratorReply`
- `activeRouteRevision`
- `activeRouteOption`
- `activeRunId`

## Workspace Section Order

`mission_snapshot.workspaceSections` uses this stable top-level order:

1. `objective`
2. `route`
3. `work_packages`
4. `checkpoints`
5. `outputs`
6. `pending_decisions`
7. `execution_summary`
8. `evidence_summary`

The first five sections are the durable workspace skeleton and must remain
present across core mission stages, using stage-aware empty states when data is
not available yet.

The last three sections are stage-sensitive emphasis blocks, but they still use
the same keys and relative order in the contract.

Compatibility note:

- Existing consumers may still read helper fields such as `mission_view`,
  `mission_spec`, and `mission_spec_contract` from the surrounding response.
- Those helper fields do not replace `mission_snapshot` as the primary Mission
  Workspace truth.

## Semantic Boundaries

### Objective

Represents the current mission objective in human-readable form.

Must not be re-derived by frontends from raw thread state when
`mission_snapshot.objective` is present.

### Route

Represents the normalized summary of the currently selected execution route.

It is not:

- the raw planner card feed
- the full revision history
- the raw proposal/change timeline

### Work Packages

Represents the task-semantic breakdown of active or planned mission work.

It is not:

- a raw node table
- a runtime frontier dump
- a deep project-management task tree

### Checkpoints

Represents structural mission gates and milestone checkpoints.

Each checkpoint should carry:

- structural type
- current state
- related mission context

It is distinct from `Pending Decisions`, which describe the current human
action needed now.

### Outputs

Represents deliverable semantics, not raw artifact-event semantics.

Outputs should emphasize:

- current deliverables
- meaningful recent history
- linkage to work/stage/evidence context

### Pending Decisions

Represents only the specific human decisions that currently block progress or
materially change mission direction.

It is not a general action menu.

### Execution Summary

Represents mission-level execution meaning.

It is not a full engine-telemetry dump.

### Evidence Summary

Represents raw evidence and drilldown entry points for:

- planner details
- proposal details
- route compare
- run details
- patch details
- graph details
- artifact trace

It supports audit and debugging, but is not the primary mission-reading path.

## Frontend Rules

Frontends may:

- format display
- sort items
- manage selection state
- manage collapse/expand state
- add presentation-only view models
- add responsive layout behavior

Frontends must not:

- redefine the primary mission stage
- redefine top-level workspace ordering
- reconstruct primary workspace semantics from raw thread/cards/run graph as a
  replacement for the contract
- create Mobile-specific and Studio-specific versions of Mission truth

## Current Consumer Alignment

Current `MW-00` and `MW-01` implementation status:

- Mobile treats a `mission_snapshot` with `workspace_contract_version > 0` as
  the primary workspace contract.
- Mobile keeps versioned `stages` contract text/status intact; runtime graph
  details remain display content rather than stage-semantic replacement.
- Mobile only uses local Mission workspace builders for
  `workspace_contract_version = 0` fallback and for presentation/body
  adaptation around the contract.
- Studio uses the same versioned snapshot guard before falling back to
  compatibility fields.
- Studio Mission Workspace, inspector rail, and mission inventory labels prefer
  the versioned `mission_snapshot` over `mission_spec` and `mission_view`
  helper fields.
- Control Plane emits the stable `MW-01` 8-module `workspaceSections` order.
- Mobile adapts the same 8 modules as persistent center-workspace sections.
- Studio sorts versioned workspace section cards by the same 8-module order.

Current verification coverage:

- `services/control-plane/test/mission-workspace.test.ts` covers contract
  stability across `draft`, `planned`, `confirmed`, `running`,
  `waiting_human`, and `completed`.
- `apps/mobile/test/mission-workspace-contract.test.ts` guards Mobile's
  versioned contract-consumption path.
- `apps/studio/scripts/check.mjs` guards Studio's versioned contract
  consumption markers.

## Stage Coverage

The contract must remain stable across:

- `draft`
- `planned`
- `confirmed`
- `running`
- `waiting_human`
- `completed`

Stable workspace skeleton blocks must remain present across stages even when
some sections need stage-aware empty states.
