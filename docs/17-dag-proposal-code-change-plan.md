# DagProposal Code Change Plan

This document turns the `DagProposal` draft into a code-level implementation
plan against the current repository structure.

It is intentionally narrower than the domain draft in
[`docs/16-dag-proposal-domain-and-api-draft.md`](/C:/project/my-mate/docs/16-dag-proposal-domain-and-api-draft.md).

The goal here is practical:

- identify the exact files to change
- define the first concrete TypeScript shapes
- define the first concrete API contracts
- define the compatibility behavior with the current session/plan/run flow

## Current Code Reality

The current repository already has:

- `SessionRecord.confirmed_plan_revision`
- `SessionRecord.confirmed_plan_option`
- `CreateRunFromSessionRequest.plan_revision`
- `CreateRunFromSessionRequest.plan_option`
- `RunRecord` without proposal linkage
- file-backed `DagPatchRecord` storage
- `POST /api/sessions/:sessionId/plan/confirm`
- `POST /api/sessions/:sessionId/runs`

## Implementation Progress

Last updated: 2026-06-30

Done:

- `DagProposalRecord` types and request/response contracts exist in
  `services/control-plane/src/types.ts`.
- `generateDagProposalId()` exists in `services/control-plane/src/utils.ts`.
- File-backed proposal storage exists in
  `services/control-plane/src/dag-proposal-store.ts`.
- Control Plane exposes:
  - `POST /api/sessions/:sessionId/dag-proposals`
  - `GET /api/sessions/:sessionId/dag-proposals`
  - `GET /api/sessions/:sessionId/dag-proposals/:proposalId`
  - `PATCH /api/sessions/:sessionId/dag-proposals/:proposalId/assignments`
  - `POST /api/sessions/:sessionId/dag-proposals/:proposalId/confirm`
  - `POST /api/sessions/:sessionId/dag-proposals/:proposalId/reject`
  - `POST /api/sessions/:sessionId/dag-proposals/:proposalId/supersede`
- `SessionRecord.confirmed_proposal_id` and `RunRecord.proposal_id` are wired
  into session confirmation and proposal-backed run creation.
- API Gateway proxies all proposal routes, including assignment `PATCH`.
- `openapi/control-plane.openapi.yaml` documents the proposal schemas and paths.
- Tests cover proposal create/update/confirm/run linkage in Control Plane and
  proposal route passthrough in API Gateway.

Verified:

- `cd services/control-plane && npm run check`
- `cd services/control-plane && npm test`
- `cd services/api-gateway && npm run check`
- `cd services/api-gateway && npm test`

Remaining:

- Studio still needs to adopt the durable proposal API:
  - create proposal records from the Orchestrator Workbench
  - load proposal history for a session
  - persist assignment edits through the proposal assignment route
  - confirm proposals before run creation
  - create runs with `proposal_id`

That means the first `DagProposal` slice should extend the current route model,
not replace it wholesale.

## Design Choice For The First Slice

Use this compatibility strategy:

1. Keep plan revision and option confirmation working.
2. Add `DagProposalRecord` as a parallel durable planning object.
3. Add explicit `confirmed_proposal_id` to sessions.
4. Add explicit `proposal_id` to runs.
5. Make session run creation prefer `proposal_id` when provided.
6. Keep `plan_revision` / `plan_option` as a fallback path.

This lets Studio adopt proposals first without breaking existing mobile or
session-first flows.

## File-Level Change List

### 1. `services/control-plane/src/types.ts`

Add:

- `DagProposalStatus`
- `DagProposalPlannerContext`
- `DagProposalAssignment`
- `DagProposalRecord`
- `DagProposalSummary`
- `CreateDagProposalRequest`
- `UpdateDagProposalAssignmentsRequest`
- `ConfirmDagProposalRequest`
- `RejectDagProposalRequest`
- `SupersedeDagProposalRequest`
- `CreateDagProposalResponse`
- `ListDagProposalsResponse`

Change:

- `SessionRecord`
- `CreateRunFromSessionRequest`
- `RunRecord`

### 2. `services/control-plane/src/utils.ts`

Add:

- `generateDagProposalId()`

Follow the same style as `generateDagPatchId()`.

### 3. `services/control-plane/src/dag-proposal-store.ts`

New file.

Add:

- `saveDagProposal`
- `createDagProposal`
- `getDagProposal`
- `listSessionDagProposals`
- `updateDagProposal`

Store path:

```text
services/control-plane/data/sessions/<sessionId>/dag-proposals/<proposalId>.json
```

### 4. `services/control-plane/src/app.ts`

Add:

- request body guards for proposal routes
- proposal route handlers
- proposal projection helpers
- proposal-aware session confirm/run logic

Change:

- `isCreateRunFromSessionBody`
- `performSessionRun(...)`
- `POST /api/sessions/:sessionId/runs`
- session summary/workspace assembly to surface `confirmed_proposal_id`

### 5. `services/api-gateway/src/app.ts`

Add gateway proxy allowlist entries for:

- `POST /api/sessions/:sessionId/dag-proposals`
- `GET /api/sessions/:sessionId/dag-proposals`
- `GET /api/sessions/:sessionId/dag-proposals/:proposalId`
- `PATCH /api/sessions/:sessionId/dag-proposals/:proposalId/assignments`
- `POST /api/sessions/:sessionId/dag-proposals/:proposalId/confirm`
- `POST /api/sessions/:sessionId/dag-proposals/:proposalId/reject`
- `POST /api/sessions/:sessionId/dag-proposals/:proposalId/supersede`

### 6. `openapi/control-plane.openapi.yaml`

Add:

- new proposal schemas
- new proposal paths
- updated session-run request shape
- updated run detail shape

Important note:

The current OpenAPI file already documents `/api/runs` and planner endpoints,
but it does not currently appear to carry the full session API surface.

So for this slice, the OpenAPI update should do one of two things:

1. add the new proposal session endpoints only, or
2. add the broader missing session endpoints as a separate catch-up pass

For momentum, option `1` is enough.

### 7. `apps/studio/src/app.js`

Change Studio proposal flow so it:

- creates durable proposal records
- loads proposal history for a session
- persists assignment edits to proposal records
- confirms proposal records before run creation
- creates runs with `proposal_id`

## Exact Type Changes

### `SessionRecord`

Current relevant fields:

```ts
confirmed_plan_revision: number | null;
confirmed_plan_option: "primary" | "alternative" | null;
metadata: Record<string, unknown>;
```

Recommended change:

```ts
export interface SessionRecord {
  session_id: string;
  title: string;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  current_goal: string | null;
  current_plan_summary: string | null;
  latest_run_id: string | null;
  active_run_ids: string[];
  last_orchestrator_message_id: string | null;
  confirmed_plan_revision: number | null;
  confirmed_plan_option: "primary" | "alternative" | null;
  confirmed_proposal_id: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  hidden: boolean;
  hidden_at: string | null;
  hidden_by: string | null;
  metadata: Record<string, unknown>;
  mission_spec?: MissionSpecSummary | null;
  mission_spec_contract?: MissionSpecContract | null;
  mission_snapshot?: MissionSnapshot | null;
}
```

Why add an explicit field instead of hiding it in `metadata`:

- session confirmation state is already first-class
- run creation needs deterministic source resolution
- UI and tests should not depend on ad hoc metadata parsing

### `CreateRunFromSessionRequest`

Current shape:

```ts
export interface CreateRunFromSessionRequest {
  template_id?: string;
  inputs?: Record<string, unknown>;
  validation_mode?: RunValidationMode;
  plan_revision?: number;
  plan_option?: "primary" | "alternative";
}
```

Recommended change:

```ts
export interface CreateRunFromSessionRequest {
  template_id?: string;
  inputs?: Record<string, unknown>;
  validation_mode?: RunValidationMode;
  plan_revision?: number;
  plan_option?: "primary" | "alternative";
  proposal_id?: string;
}
```

Resolution rule:

- if `proposal_id` is present, use proposal-backed execution source resolution
- else use current `plan_revision` / `plan_option` behavior
- else use current confirmed/latest fallback behavior

### `RunRecord`

Current shape has no proposal linkage.

Recommended change:

```ts
export interface RunRecord {
  run_id: string;
  template_id: string;
  template_version: number;
  workspace_id: string;
  requested_by: string;
  intent: string;
  status: RunStatus;
  current_summary: string;
  waiting_reason: string | null;
  blocked_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
  inputs: Record<string, unknown>;
  proposal_id: string | null;
}
```

This should be a top-level nullable field, not only metadata.

Reason:

- it is core lineage
- it will be queried in session/mission views
- it should stay stable across storage reloads and tests

### New Proposal Types

Recommended first slice:

```ts
export type DagProposalStatus =
  | "draft"
  | "review_ready"
  | "confirmed"
  | "rejected"
  | "superseded";

export interface DagProposalPlannerContext {
  provider_id: string | null;
  model: string | null;
  orchestrator_profile_id: string | null;
  system_prompt_summary: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
}

export interface DagProposalAssignment {
  node_id: string;
  node_name: string | null;
  subagent_profile_id: string | null;
  provider: string | null;
  model: string | null;
  allowed_tools: string[];
  allowed_skills: string[];
  input_context: string | null;
  output_contract: string | null;
  metadata: Record<string, unknown>;
}

export interface DagProposalRecord {
  proposal_id: string;
  mission_id: string;
  session_id: string;
  orchestrator_profile_id: string | null;
  source_message_id: string | null;
  source_revision: number | null;
  source_option: "primary" | "alternative" | null;
  status: DagProposalStatus;
  title: string;
  summary: string;
  mission_spec_contract: MissionSpecContract | null;
  planner_context: DagProposalPlannerContext;
  dag_draft: Record<string, unknown>;
  route_compare: RouteCompareSummary | null;
  assignments: DagProposalAssignment[];
  warnings: string[];
  checklist: string[];
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  superseded_at: string | null;
  superseded_by_proposal_id: string | null;
  supersedes_proposal_id: string | null;
  metadata: Record<string, unknown>;
}

export interface DagProposalSummary {
  proposal_id: string;
  session_id: string;
  mission_id: string;
  status: DagProposalStatus;
  title: string;
  summary: string;
  source_revision: number | null;
  source_option: "primary" | "alternative" | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDagProposalRequest {
  source_message_id?: string;
  source_revision?: number;
  source_option?: "primary" | "alternative";
  template_id?: string;
  inputs?: Record<string, unknown>;
}

export interface UpdateDagProposalAssignmentsRequest {
  assignments: DagProposalAssignment[];
}

export interface ConfirmDagProposalRequest {
  confirmed_by?: string;
}

export interface RejectDagProposalRequest {
  rejected_by?: string;
  reason?: string;
}

export interface SupersedeDagProposalRequest {
  source_message_id?: string;
  reason?: string;
  template_id?: string;
  inputs?: Record<string, unknown>;
}
```

## `app.ts` Behavior Changes

### 1. Extend `isCreateRunFromSessionBody`

Add validation for:

```ts
if ("proposal_id" in value && value.proposal_id !== undefined && typeof value.proposal_id !== "string") {
  return false;
}
```

Also update the error message on
`POST /api/sessions/:sessionId/runs` to mention `proposal_id`.

### 2. Add Proposal Confirmation Route

New route:

`POST /api/sessions/:sessionId/dag-proposals/:proposalId/confirm`

Behavior:

- load session
- load proposal
- verify proposal belongs to session
- reject if route is stale relative to live MissionSpec and proposal snapshot policy says stale
- mark proposal `confirmed`
- set `session.confirmed_proposal_id = proposalId`
- keep `confirmed_plan_revision` / `confirmed_plan_option` when known
- append orchestrator confirmation message

Do not remove `POST /api/sessions/:sessionId/plan/confirm`.

Compatibility rule:

- old plan confirm keeps working
- proposal confirm becomes the preferred Studio path

### 3. Add Proposal-Aware Run Resolution

In `performSessionRun(...)`, add source resolution precedence:

1. explicit request `proposal_id`
2. `session.confirmed_proposal_id`
3. explicit request `plan_revision` + `plan_option`
4. session confirmed revision/option
5. current fallback behavior

If proposal-backed path is used:

- load proposal
- extract execution config from proposal snapshot
- use proposal `dag_draft` / route source as the execution anchor
- write `proposal_id` onto the created run

### 4. Proposal Generation Route

New route:

`POST /api/sessions/:sessionId/dag-proposals`

Handler responsibilities:

- resolve session and latest goal
- resolve planner invocation options from session/orchestrator profile
- call existing planner + draft helpers
- build `DagProposalRecord`
- persist it
- optionally append a planning evidence message with `proposal_id`

### 5. Proposal List And Detail Routes

Add:

- `GET /api/sessions/:sessionId/dag-proposals`
- `GET /api/sessions/:sessionId/dag-proposals/:proposalId`

List route should return summaries first, not full heavy payloads.

### 6. Assignment Patch Route

Add:

`PATCH /api/sessions/:sessionId/dag-proposals/:proposalId/assignments`

First slice behavior:

- full assignment array replacement is acceptable
- no need for per-node patch semantics yet

### 7. Reject And Supersede Routes

Add:

- `POST /api/sessions/:sessionId/dag-proposals/:proposalId/reject`
- `POST /api/sessions/:sessionId/dag-proposals/:proposalId/supersede`

Supersede behavior:

- mark current proposal `superseded`
- generate a replacement proposal
- set linkage fields both ways

## Session Summary / Workspace Changes

Where session summary payloads currently expose:

- `confirmed_plan_revision`
- `confirmed_plan_option`

also expose:

- `confirmed_proposal_id`

Recommended rule:

- keep proposal id visible in summary/workspace state
- do not force clients to inspect generic metadata

## `session-store.ts` Changes

Update `createSession(...)` default fields:

```ts
confirmed_proposal_id: null,
```

Update normalization logic to backfill:

```ts
confirmed_proposal_id:
  typeof record.confirmed_proposal_id === "string" && record.confirmed_proposal_id.trim()
    ? record.confirmed_proposal_id.trim()
    : null,
```

This is important for old session JSON records.

## `run-store` Compatibility

Any run store normalization should also tolerate older run records missing
`proposal_id`.

Backfill rule:

```ts
proposal_id:
  typeof record.proposal_id === "string" && record.proposal_id.trim()
    ? record.proposal_id.trim()
    : null,
```

## OpenAPI Contract Changes

### 1. Update Existing Session-Run Request Schema

If a session-run schema already exists in OpenAPI, extend it with:

```yaml
proposal_id:
  type: string
```

If it does not yet exist, add:

`CreateRunFromSessionRequest`

with:

- `template_id`
- `inputs`
- `validation_mode`
- `plan_revision`
- `plan_option`
- `proposal_id`

### 2. Update Run Detail / Run Summary

Add nullable proposal linkage:

```yaml
proposal_id:
  type: string
  nullable: true
```

At minimum add it to detailed run payloads.

### 3. Add Proposal Schemas

Add:

- `DagProposalStatus`
- `DagProposalPlannerContext`
- `DagProposalAssignment`
- `DagProposalSummary`
- `DagProposalRecord`
- `CreateDagProposalRequest`
- `UpdateDagProposalAssignmentsRequest`
- `ConfirmDagProposalRequest`
- `RejectDagProposalRequest`
- `SupersedeDagProposalRequest`

### 4. Add Proposal Paths

Recommended OpenAPI paths:

```text
POST   /api/sessions/{sessionId}/dag-proposals
GET    /api/sessions/{sessionId}/dag-proposals
GET    /api/sessions/{sessionId}/dag-proposals/{proposalId}
PATCH  /api/sessions/{sessionId}/dag-proposals/{proposalId}/assignments
POST   /api/sessions/{sessionId}/dag-proposals/{proposalId}/confirm
POST   /api/sessions/{sessionId}/dag-proposals/{proposalId}/reject
POST   /api/sessions/{sessionId}/dag-proposals/{proposalId}/supersede
```

## First Concrete Response Shapes

Recommended create response:

```ts
export interface CreateDagProposalResponse {
  session: SessionRecord;
  proposal: DagProposalRecord;
}
```

Recommended list response:

```ts
export interface ListDagProposalsResponse {
  items: DagProposalSummary[];
  confirmed_proposal_id: string | null;
}
```

Recommended confirm response:

```ts
export interface ConfirmDagProposalResponse {
  session: SessionRecord;
  proposal: DagProposalRecord;
  message: SessionMessageRecord;
}
```

## Studio Adoption Rules

Once the backend exists, Studio should switch to:

1. user drafts route
2. Studio creates `DagProposalRecord`
3. Studio edits persisted assignments
4. user confirms proposal
5. Studio creates run with `proposal_id`

Studio should stop treating proposal edit state as primarily local once the
proposal API is available.

## Test Plan By File

### `services/control-plane/test`

Add:

- `dag-proposal-store.test.ts`
- proposal route tests in `app.test.ts`
- proposal-backed run creation coverage

Core assertions:

- create/list/get proposal works
- confirm proposal updates session `confirmed_proposal_id`
- run created from proposal stores `run.proposal_id`
- old sessions and runs without proposal fields still load correctly

### `services/api-gateway/test/app.test.ts`

Add passthrough coverage for all new proposal routes.

### `apps/studio`

Add at minimum:

- proposal load/persist smoke
- confirmed proposal -> run flow smoke

## Suggested Implementation Order

1. `types.ts`
2. `utils.ts`
3. `dag-proposal-store.ts`
4. control-plane route handlers
5. session/run source-resolution changes
6. gateway passthrough
7. OpenAPI updates
8. Studio adoption
9. tests

## Implementation Status

Last checked: 2026-06-30

Completed:

- `DagProposalRecord` and related request/response types are defined in
  `services/control-plane/src/types.ts`.
- `generateDagProposalId()` exists in `services/control-plane/src/utils.ts`.
- `services/control-plane/src/dag-proposal-store.ts` provides file-backed
  create/get/list/update behavior.
- `SessionRecord.confirmed_proposal_id` and `RunRecord.proposal_id` are
  first-class fields with backward-compatible normalization.
- Control Plane exposes session proposal create/list/get/assignment update/
  confirm/reject/supersede routes.
- Session run creation accepts `proposal_id` and persists run lineage.
- Direct `/api/runs` creation also accepts and returns `proposal_id`.
- API Gateway proxies all proposal routes, including assignment `PATCH`.
- OpenAPI includes first-slice `DagProposal` schemas and paths.
- Control Plane and Gateway tests cover proposal persistence, assignment edits,
  confirmation, proposal-backed run creation, and gateway passthrough.
- Studio Orchestrator Workbench loads durable session proposals, creates new
  proposals, persists assignment edits, confirms proposals, and launches session
  runs with `proposal_id`.
- Studio browser E2E passed against local Studio/Gateway/Control Plane on
  2026-06-30. The walkthrough created a new mission, created a durable
  proposal, persisted an edited assignment model, confirmed the proposal, and
  launched a completed run with matching `run.proposal_id`.
- Mobile run summaries, run follow-up, and mission overview surfaces now expose
  durable `proposal_id` backlinks.

Remaining:

- No first-slice `DagProposal` implementation items remain.

## Scope Guard

Do not combine this slice with:

- runtime graph editor work
- `DagPatchRecord` redesign
- MissionSpec model rewrite
- broader mobile shell migration

The point of this slice is narrower:

make proposal identity durable and make `proposal_id` the explicit bridge from
planning into execution.
