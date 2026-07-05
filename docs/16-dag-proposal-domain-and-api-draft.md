# DagProposal Domain And API Draft

This document defines the next backend contract needed after the current
Studio V2 workbench rollout:

`DagProposal` should become a first-class, durable orchestration object.

Today, the Studio `DAG Proposal` surface is assembled from existing data:

- planner candidate plan
- DAG draft
- route compare summary
- inline proposal edits held in UI state until saved elsewhere

That is sufficient for the current MVP, but it leaves one important gap:

- there is no durable proposal record with a stable id
- there is no backend lifecycle for review, confirm, reject, and supersede
- runs cannot point back to a formal proposal object
- proposal history is inferred from cards rather than persisted directly

This draft turns `DagProposal` into a file-backed control-plane object that can
be exposed through the API gateway and used directly by Studio.

## Goals

`DagProposal` should provide:

1. a durable proposal object above raw planner response payloads
2. a stable review and confirmation target before run creation
3. explicit linkage across MissionSpec, Session, proposal, and Run
4. persistent subagent assignment edits before execution
5. proposal history across revise, stale-route, and supersede flows

## Non-Goals

This first slice does not require:

- replacing `MissionSpecContract`
- replacing `plan_card` or `plan_options_card` immediately
- introducing a new runtime mutation model
- replacing `DagPatchRecord`
- changing the execution adapter protocol

`DagProposal` should sit between MissionSpec/session planning and real run
creation. It is a planning object, not a runtime patch object.

## Position In The Current Model

Current durable objects already in the repository:

- `SessionRecord`
- `SessionMessageRecord`
- `MissionSpecSummary`
- `MissionSpecContract`
- `DagPatchRecord`
- `RunRecord` and compiled run-plan state

Missing durable object:

- `DagProposalRecord`

Recommended relationship:

`MissionSpecContract` -> `DagProposalRecord` -> `RunRecord`

Where:

- `MissionSpecContract` is the orchestration contract
- `DagProposalRecord` is the proposed execution route
- `RunRecord` is the confirmed execution instance

## Domain Model

### Status Model

Recommended `DagProposalStatus` values:

- `draft`
- `review_ready`
- `confirmed`
- `rejected`
- `superseded`

Meaning:

- `draft`: proposal object exists but is still being assembled or edited
- `review_ready`: proposal is complete enough for human review
- `confirmed`: selected as an execution source
- `rejected`: explicitly declined by the user/operator
- `superseded`: replaced by a newer proposal after brief/constraint/revision drift

`confirmed` and `superseded` should both remain readable for audit history.

### Record Shape

Suggested control-plane type:

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
```

## Field Notes

### Identity And Lineage

- `proposal_id`: stable proposal id
- `mission_id`: keeps proposal attached to the mission workspace model
- `session_id`: preserves the current session-native interaction anchor
- `source_message_id`: the session message that triggered proposal generation
- `source_revision`: route lineage anchor when generated from a specific revision
- `source_option`: `primary` or `alternative` when generated from a plan-options path

### Contract Snapshot

`mission_spec_contract` should be copied onto the proposal at generation time.

Reason:

- proposal review must stay readable even if the live session moves forward
- stale-route detection needs a stable contract anchor
- run creation should be able to reference the reviewed contract snapshot

This does not replace the live MissionSpec projection. It preserves the
proposal's planning context at the time of review.

### `dag_draft`

For the first slice, keep `dag_draft` as a permissive object payload aligned to
the existing `POST /api/planner/dag-draft` response shape.

Do not block this slice on a separate proposal-specific schema if the current
planner draft shape is already stable enough for the workbench.

### Assignments

`assignments` should hold the editable pre-run subagent plan currently exposed
by Studio proposal cards.

The important shift is:

- current behavior: editable assignment intent mostly lives in UI state
- target behavior: editable assignment intent is persisted on the proposal

### Warnings And Checklist

Keep these as explicit arrays on the proposal record instead of forcing Studio
to recalculate them from planner cards.

Typical examples:

- missing required approval gate
- low registry readiness
- tool mismatch
- output contract ambiguity
- brief changed after proposal generation

## Storage Model

Follow the same file-backed pattern already used by session and patch stores.

Suggested path:

```text
services/control-plane/data/sessions/<sessionId>/dag-proposals/<proposalId>.json
```

Suggested store module:

`services/control-plane/src/dag-proposal-store.ts`

Suggested helpers:

- `createDagProposal`
- `saveDagProposal`
- `getDagProposal`
- `listSessionDagProposals`
- `updateDagProposal`
- `listMissionDagProposals` if mission id is later materialized independently

## Lifecycle

### 1. Generate

Trigger:

- user asks Studio/session orchestrator to draft a route
- existing planner endpoints return candidate plan and DAG draft

Result:

- create `DagProposalRecord`
- status becomes `review_ready`
- project a `dag_proposal_card` or proposal reference into the session if needed

### 2. Edit

Trigger:

- operator changes subagent assignment
- operator changes tool/model intent
- operator edits input/output contract expectations

Result:

- update `assignments`
- update `updated_at`
- optionally append audit metadata for changed fields

### 3. Confirm

Trigger:

- operator confirms proposal for execution

Result:

- mark selected proposal `confirmed`
- persist `confirmed_at` and `confirmed_by`
- session stores proposal linkage in metadata or explicit fields
- subsequent run creation references `proposal_id`

### 4. Reject

Trigger:

- operator declines proposal

Result:

- mark proposal `rejected`
- preserve it for history

### 5. Supersede

Trigger:

- mission brief changes
- constraints change
- a revise action generates a better proposal
- route becomes stale relative to current MissionSpec

Result:

- old proposal becomes `superseded`
- new proposal stores `supersedes_proposal_id`
- old proposal stores `superseded_by_proposal_id`

## API Draft

The current planner endpoints should remain reusable.

New proposal endpoints should sit on top of them and persist the result.

### Create Proposal

`POST /api/sessions/:sessionId/dag-proposals`

Request draft:

```json
{
  "source_message_id": "msg_123",
  "source_revision": 3,
  "source_option": "primary",
  "template_id": "software_delivery_v2",
  "inputs": {
    "goal": "Prepare a release candidate build and QA pass."
  }
}
```

Behavior:

- resolve session + MissionSpec context
- invoke existing planner/draft pipeline
- assemble route compare summary if applicable
- persist `DagProposalRecord`
- return proposal detail

### List Proposals

`GET /api/sessions/:sessionId/dag-proposals`

Response:

- latest proposal first
- include status and summary fields for review history

### Get Proposal

`GET /api/sessions/:sessionId/dag-proposals/:proposalId`

Response:

- full `DagProposalRecord`

### Update Assignments

`PATCH /api/sessions/:sessionId/dag-proposals/:proposalId/assignments`

Request draft:

```json
{
  "assignments": [
    {
      "node_id": "qa_pass",
      "subagent_profile_id": "review-agent",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "allowed_tools": ["browser", "github"],
      "allowed_skills": ["review", "qa"],
      "input_context": "Focus on regression and release notes consistency.",
      "output_contract": "Return defects, release risk, and a ship recommendation."
    }
  ]
}
```

Behavior:

- patch persisted assignment intent
- keep the rest of the proposal stable

### Confirm Proposal

`POST /api/sessions/:sessionId/dag-proposals/:proposalId/confirm`

Request draft:

```json
{
  "confirmed_by": "user"
}
```

Behavior:

- mark proposal `confirmed`
- update session confirmation linkage
- optionally invalidate older `review_ready` proposals derived from the same route

### Reject Proposal

`POST /api/sessions/:sessionId/dag-proposals/:proposalId/reject`

Request draft:

```json
{
  "rejected_by": "user",
  "reason": "Need a simpler route with fewer handoffs."
}
```

### Supersede Proposal

`POST /api/sessions/:sessionId/dag-proposals/:proposalId/supersede`

Request draft:

```json
{
  "source_message_id": "msg_127",
  "reason": "Mission brief changed after stakeholder feedback."
}
```

Behavior:

- create a new proposal from the latest mission/session context
- mark the old proposal `superseded`
- link both records

## Run Creation Contract Change

Current direction should become:

- plan/route review selects a `proposal_id`
- run creation uses the confirmed proposal as the execution source

Recommended change:

`POST /api/sessions/:sessionId/runs`

should accept:

```json
{
  "proposal_id": "prop_20260630_001",
  "validation_mode": "strict"
}
```

Rules:

- if `proposal_id` is provided, it wins over inferred latest revision/option
- if omitted, current backward-compatible behavior can remain temporarily
- long term, Studio should create runs from confirmed proposal ids explicitly

## Session And Mission Projection

Proposal data should be projected back into mission/session views, but the
proposal object remains the source of truth.

Possible session message kinds:

- `dag_proposal_card`
- or keep existing `draft_card` / `plan_options_card` for compatibility while
  adding a `proposal_id` backlink

Recommended first slice:

- keep existing cards for compatibility
- add `proposal_id` references to planning cards where possible
- let Studio fetch durable proposal records for actual edit/confirm flows

## Backward Compatibility

The slice should be staged without breaking existing mobile/session flows.

Recommended transition:

1. add `DagProposalRecord` store and APIs
2. keep current planner endpoints unchanged
3. let Studio create and use proposal records first
4. add `proposal_id` as an optional run creation input
5. later migrate session planning cards to reference proposal ids directly

## Validation And Tests

Minimum required tests:

### Control Plane

- store create/get/list/update coverage
- confirm/reject/supersede lifecycle coverage
- stale-route proposal supersede behavior
- run creation with `proposal_id` coverage

### API Gateway

- proxy route passthrough for proposal create/list/get/update/confirm/reject

### Studio

- proposal generation from workbench
- reload and restore latest proposal
- inline assignment edit persists through refresh
- confirm proposal then create run from confirmed proposal

## Implementation Order

Recommended sequence:

1. add `DagProposalRecord` types in `services/control-plane/src/types.ts`
2. add id generator in `services/control-plane/src/utils.ts`
3. add `dag-proposal-store.ts`
4. add control-plane routes and lifecycle handlers
5. add gateway allowlist and passthrough coverage
6. update Studio workbench to read/write proposal records
7. add optional `proposal_id` linkage to run creation
8. add tests and acceptance screenshots

## Open Decisions

These decisions should be made during implementation, not blocked at the
document stage:

1. Should `proposal_id` live directly on `RunRecord`, or only in run metadata?
2. Should session confirmation state store a `confirmed_proposal_id` explicitly?
3. Should `DagProposalRecord` store a full compiled run plan snapshot, or only
   the draft + route summary for the first slice?
4. Should proposal editing be append-only audit metadata, or simple overwrite in
   the first file-backed version?

## Recommendation

For the next implementation slice:

- keep the first `DagProposalRecord` simple and file-backed
- store enough snapshot data to survive session drift
- make `proposal_id` the explicit bridge from planning into execution
- avoid redesigning MissionSpec or runtime patching in the same change

That gives Studio V2 the missing durable planning object without widening the
scope into a larger orchestration rewrite.
