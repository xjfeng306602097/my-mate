# RT-04 Structured Edge Conditions And Failure Recovery

Status: implementation baseline complete.

Last updated: 2026-07-12.

## Goal

RT-04 closes two related runtime gaps:

1. Workflow edges are selected by a safe, persisted, structured condition
   language rather than being treated mainly as labels.
2. A terminal node failure may route to an explicit recovery branch without
   prematurely terminating the Run.

The failed source node remains `failed`. Recovery is represented by routing
evidence, not by rewriting failure history.

## Architecture

```text
Worker handoff or failed execution report
  -> RuntimeEngine builds EdgeConditionContext
  -> safe AST evaluator checks port and condition independently
  -> per-edge decisions are persisted on NodeHandoffRecord
  -> matching targets become ready
  -> untaken exclusive targets become skipped
  -> RuntimeEngine dispatches the selected frontier
  -> Runtime Graph, Trace, Replay, and Scorecard consume the same decisions
```

The Manager synthesizes a `failure` handoff only when a failed report has a
failure-port or conditioned recovery candidate and the Worker did not already
provide a routed failure handoff.

When a Worker reports completion without a handoff, the Manager similarly
synthesizes a `success` handoff when the node has ported or conditioned edges.
Handoffs are selected within the current Job identity, so an earlier retry
attempt cannot poison the next attempt's routing decision.

## Condition Contract

Conditions are declarative JSON AST values. Arbitrary JavaScript, shell, or
template evaluation is not supported.

Lifecycle conditions:

```json
{ "kind": "always" }
{ "kind": "on_success" }
{ "kind": "on_failure" }
```

Predicates:

```json
{ "path": "handoff.content.score", "op": "gte", "value": 90 }
```

Supported operators are `exists`, `not_exists`, `eq`, `neq`, `in`, `not_in`,
`contains`, `gt`, `gte`, `lt`, and `lte`.

Composition:

```json
{
  "all": [
    { "kind": "on_success" },
    { "path": "handoff.content.labels", "op": "contains", "value": "verified" },
    { "not": { "path": "handoff.content.blocked", "op": "eq", "value": true } }
  ]
}
```

The evaluation root contains only:

- `outcome`
- `handoff`
- `error`
- `source`
- `run`

Paths are own-property lookups. Prototype-related path segments are blocked.
AST depth and child count are bounded. Unknown operators, invalid operands,
extra fields, unsafe paths, and malformed composition fail closed.

## Routing Rules

Port matching and condition evaluation are independent. An edge is taken only
when both match.

- Success aliases: `success`, `completed`, `complete`, `done`, `default`.
- Failure aliases: `failure`, `failed`, `error`, `rejected`.
- An edge without a condition defaults to success behavior.
- A failure-port edge without a condition is the default failure route.
- Multiple edges may share a port; their conditions select the actual branch.
- A condition or port edge is dependency-satisfied only by persisted routing
  evidence. Source completion alone is not enough.
- Invalid conditions never route a target.

Per-edge results persist `port_matched`, `condition_matched`,
`condition_valid`, `matched`, and a deterministic reason. This makes routing
replayable and prevents projections from re-evaluating mutable input later.

## Failure Recovery State Machine

```text
node report = failed
  -> persist node.failed and job.failed
  -> retry budget remains?
       yes: prepare retry; do not evaluate recovery
       no: inspect explicit failure handoff
  -> explicit routed failure handoff exists?
       yes: restore Run to running and dispatch recovery
       no: synthesize failure handoff when candidates exist
  -> at least one recovery target routed?
       yes: restore Run to running and dispatch recovery
       no: keep Run failed
```

Invariants:

- Retry has higher priority than recovery.
- Explicit failure handoffs are persisted but do not activate recovery while
  retry budget remains.
- A recovered source node remains `failed`.
- A Run may complete when every node is completed, skipped, cancelled, or is
  a failed node with a persisted routed failure handoff.
- An unmatched failure handoff terminates the Run.
- A completed callback following an explicit unrouted failure handoff is
  converted to `unrouted_failure_handoff`.
- Recovery audit events do not mutate a terminal source node back to progress.

## Projection And Evaluation

`NodeHandoffRecord` now carries:

- `source_outcome`
- `synthetic`
- `routing_decisions`

Runtime Graph uses those records as its routing authority:

- routed edges are `active` or `satisfied`
- evaluated but untaken edges are `blocked` and remain visually skipped when
  their target is skipped
- recovered failed nodes retain status `failed` and gain the
  `recovered_failure` marker
- recovered failures count as terminal progress but not as blocked runtime
  work

Trace handoff spans expose the source outcome, synthetic flag, routed/skipped
counts, and matched-condition count. Pipeline scorecards accept failed nodes
inside completed Runs only when recovery routing evidence exists, and taken
edge detection includes routed failed sources.

## Acceptance Coverage

The focused suite covers:

- lifecycle, predicate, composition, alias, bound, and fail-closed behavior
- two edges sharing one port and selecting by handoff content
- failure routing that keeps a Run active
- recovery completion with the failed source evidence unchanged
- failure condition mismatch
- explicit failure handoff without a matching target
- retry before recovery
- success routing without a Worker-provided handoff and retry-attempt isolation
- Runtime Graph recovered markers and edge status
- scorecard terminal consistency, required handoff, and terminal monotonicity
- existing handoff port and branch-skip compatibility

Verification commands:

```bash
npm --prefix services/control-plane run check
node --import tsx --test services/control-plane/test/runtime-engine.test.ts services/control-plane/test/edge-condition.test.ts
node --import tsx --test services/control-plane/test/scorecard.test.ts services/control-plane/test/trace-replay.test.ts services/control-plane/test/runtime-protocol.test.ts
npm run runtime-worker:smoke
npm run runtime-worker:recovery-smoke
```

## Follow-Up Boundary

RT-04 does not add arbitrary expression execution, dynamic fanout, or native
Worker gate suspension. Those remain separate runtime slices. The next runtime
semantics item is `RT-05` Worker-native human-gate suspend/resume.
