# HomeRail Gap Closure Plan

Status: closure record after the 2026-07-10 human-flow comparison.

Detailed P0-P1 architecture, contracts, flows, migration strategy, test
matrix, and delivery slices are specified in
`docs/27-p0-p1-implementation-blueprint.md`. This document remains the concise
gap and priority summary; document 27 is the implementation source of truth.

This document covers four product gaps that are now closed by `HR-P0` and
`HR-P1`:

1. Operator loop: doctor, supervise, scorecard, eval, replay, and trace.
2. Graph-first runtime UX.
3. Canonical route and work-package identity for every run.
4. Provider-native tool, usage, cost, and result evidence.

The current implementation also includes generated Control Plane DTOs and a
typed SDK client under `@my-mate/shared-types/control-plane`; the CLI consumes
those contracts for the full operator and evaluation loop. Remaining work in
the broader roadmap is production governance/productization rather than the
HomeRail-alignment gaps listed above.

## Scope Boundary

HomeRail's `offline-deterministic` profile does not use a model. It is useful
for runtime conformance, but it does not evaluate model quality. My Mate must
keep these verdicts separate:

- `pipeline_verdict`: scheduling, worker, handoff, artifact, and cleanup truth.
- `contract_verdict`: declared output and evidence contracts.
- `quality_verdict`: task-specific semantic quality, or `not_evaluated`.

A deterministic run may pass the first two verdicts while leaving semantic
quality as `not_evaluated`. A single PASS must never hide that distinction.

## Reference Lessons From HomeRail

Useful patterns to adopt:

- CLI commands are thin clients; Manager owns readiness and evaluation logic.
- Evaluation reads one persisted run snapshot containing graph, node states,
  events, handoffs, chats, and usage.
- Scorecard policy belongs to the workflow and supports `off`, `advisory`, and
  `strict` enforcement.
- Supervision is cursor-based and reports only changed runtime state.
- The runtime graph is the primary surface; node detail is secondary drilldown.
- Missing token or cost data is explicit (`usage_available=false`, cost null).

Patterns not to copy as-is:

- HomeRail trace infers tool calls from chat payload shapes. The verified run
  showed that this can return sessions with no tool calls despite handoff tool
  evidence. My Mate trace must consume first-class evidence events.
- HomeRail replay is a diagnosis report, not deterministic re-execution. My
  Mate must distinguish audit replay, rerun planning, and an actual new run.
- Structural scorecard success must not be presented as semantic task quality.

## Target Architecture

```text
Runtime stores
  run + route snapshot + run plan + node runs
  jobs + workers + leases
  events + evidence + handoffs + artifacts
            |
            v
RunEvidenceSnapshotBuilder
            |
            +--> supervise cursor projection
            +--> trace spans
            +--> scorecard engine
            +--> evaluation engine
            +--> replay-plan engine
            |
            v
Control Plane APIs
            |
            +--> @my-mate/cli
            +--> Studio graph and evidence drawer
            +--> Mobile compact timeline
```

The Control Plane remains the only owner of verdicts and projections. CLI and
UI must not recompute scorecards independently.

## Foundation 1: Canonical Run Route

### Problem

Session route projection currently depends on plan/proposal messages. A direct
template run can have a concrete `RunPlanRecord` and still appear `Unrouted`
with zero work packages.

### Contract

Persist a route snapshot for every run:

```ts
interface RunRouteSnapshot {
  run_id: string;
  route_id: string;
  source_kind:
    | "session_plan"
    | "proposal"
    | "direct_template"
    | "rerun"
    | "legacy";
  template_id: string;
  template_version: number;
  template_name: string;
  plan_revision: number | null;
  plan_option: "primary" | "alternative" | null;
  proposal_id: string | null;
  node_count: number;
  edge_count: number;
  work_packages: Array<{
    key: string;
    label: string;
    order: number;
    node_run_ids: string[];
    identity_source: "declared" | "compiler_default" | "legacy_inferred";
  }>;
  created_at: string;
}
```

Rules:

- `createRunAndPersist` always receives or synthesizes this snapshot.
- A direct template run uses `template:<id>@<version>` as its route id.
- Session and Mission projections fall back to the latest run route snapshot
  when no plan or proposal message exists.
- The compiler materializes work-package identity into every compiled node.
  New undeclared nodes receive an honest one-node compiler default; only
  historical plans use the existing name-based inference and mark it legacy.
- Work packages are derived from these compiled bindings; Studio and Mobile
  do not independently guess them.
- Historical runs receive a read-time `legacy` snapshot from template and run
  plan data. No destructive migration is required for the first release.

### Target Files

- `services/control-plane/src/types.ts`
- `services/control-plane/src/app.ts`
- `services/control-plane/src/run-plan-compiler.ts`
- `services/control-plane/src/mission-workspace.ts`
- `services/control-plane/src/runtime-graph.ts`
- `apps/mobile/lib/task-thread.ts`

### Exit Gate

- A session run created with only `template_id` shows a named route and all
  compiled work packages in Studio and Mobile.
- Plan, proposal, direct, and historical runs pass the same projection tests.

## Foundation 2: Unified Evidence Snapshot

HomeRail evaluation succeeds operationally because all evaluators consume one
snapshot. My Mate currently has richer stores, but no canonical evaluation
input.

```ts
interface RunEvidenceSnapshot {
  schema_version: 1;
  snapshot_id: string;
  snapshot_state: "terminal" | "incomplete";
  generated_at: string;
  run: RunRecord;
  route: RunRouteSnapshot;
  initial_plan: RunPlanRecord;
  effective_plan: RunPlanRecord;
  node_runs: NodeRunRecord[];
  runtime_jobs: RuntimeJobRecord[];
  runtime_workers: RuntimeWorkerRecord[];
  worker_leases: WorkerLeaseRecord[];
  event_cursors: RuntimeEventCursorRecord[];
  events: EventRecord[];
  evidence: WorkerEvidence[];
  handoffs: NodeHandoffRecord[];
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
  human_inputs: HumanInputRecord[];
  interventions: SessionInterventionRecord[];
  dag_patches: DagPatchRecord[];
  completeness: SnapshotCompleteness;
  snapshot_cursor: string;
  evidence_digest: string;
}
```

Rules:

- Ordering is stable by timestamp, sequence, then id.
- The digest covers evaluation-relevant normalized data, not secret fields.
- Scorecard/eval results persist the digest and policy version they evaluated.
- Redaction happens before evidence persistence and before digest generation.
- Runtime workers are joined through run-scoped leases; unrelated shared
  workers never enter the snapshot or cleanup verdict.
- CLI, Studio, Mobile, and tests consume the same snapshot builder.

Target modules:

- `services/control-plane/src/evaluation/run-evidence-snapshot.ts`
- `services/control-plane/src/evaluation/types.ts`
- `services/control-plane/src/evaluation/*-store.ts`

## Operator Loop

Create `apps/cli` as `@my-mate/cli` with a `my-mate` binary. Use Commander as
a thin HTTP client, matching HomeRail's operational separation.

Control Plane owns the corresponding operations:

| CLI | Control Plane API | Semantics |
| --- | --- | --- |
| `doctor` | `POST /api/diagnostics/doctor` | Run non-destructive readiness probes. |
| `supervise` | `GET /api/runs/:runId/supervise` | Read cursor-based runtime deltas. |
| `scorecard` | `POST /api/runs/:runId/scorecards` | Evaluate and persist by snapshot digest and policy version. |
| `eval` | `POST /api/runs/:runId/evaluations` | Evaluate and persist independent verdict dimensions. |
| `trace` | `GET /api/runs/:runId/trace` | Project first-class evidence into spans. |
| `replay` | `POST /api/runs/:runId/replays` | Rebuild state from immutable events. |
| `replay-plan` | `POST /api/runs/:runId/replay-plans` | Diagnose failures and propose changes. |
| `rerun` | `POST /api/runs/:runId/reruns` | Create a linked run from immutable inputs. |

Scorecard and evaluation POSTs are idempotent for the same evidence digest,
policy version, and evaluator version. The CLI only renders API results and
maps verdicts to exit codes; it does not implement evaluation logic.

### Doctor

`my-mate doctor [--docker] [--runtime <kind>] [--json]`

Checks:

- Control Plane and Gateway reachability.
- Storage backend read/write probe.
- Runtime dispatcher, provisioner, and Worker Hub readiness.
- Docker CLI, Linux daemon, worker image existence, and image version/digest.
- Worker WebSocket registration loopback.
- Workspace mount/read/write behavior.
- Harness command availability.
- Provider setting and credential reference presence without exposing secrets.

Return separate readiness fields:

```json
{
  "runtime_ready": true,
  "deterministic_ready": true,
  "model_ready": false,
  "checks": []
}
```

Missing model configuration must not make deterministic runtime readiness look
failed. A model-backed run request must still fail its own readiness gate.

### Supervise

`my-mate supervise <run_id> [--follow] [--cursor <cursor>] [--json]`

API: `GET /api/runs/:runId/supervise?cursor=<cursor>`

Response includes run status, frontier, changed nodes, active resources, new
handoffs/evidence/artifacts, open gates, and a new cursor. The opaque cursor is
a versioned compound position over run events, worker evidence, handoffs, and
artifacts, using each stream's stable `(created_at, id)` key. It is distinct
from `RuntimeEventCursorRecord`, which exists to reject duplicate or
out-of-order Worker events during ingestion. Never use array length as a
supervision cursor.

### Scorecard

`my-mate scorecard <run_id> [--json]`

Add workflow policy:

```ts
interface ScorecardPolicy {
  profile: string;
  version: number;
  enforcement: "off" | "advisory" | "strict";
  checks: ScorecardCheckDefinition[];
}
```

Always-on pipeline checks:

- Run reached an expected terminal status.
- All expected nodes are terminal and no node failed unexpectedly.
- No active job, connected ephemeral worker, or active lease remains.
- Taken edges have matching non-empty handoffs.
- Required artifacts exist and their references resolve.
- Worker events are ordered/idempotent and no terminal state regressed.
- Blocked redaction evidence is surfaced as a failure or blind spot.

Declarative checks:

- JSON Schema for handoff and artifact metadata.
- Required evidence kinds and tool names.
- Required output artifacts and MIME types.
- Structured test categories such as lint/unit/integration/rollback.
- Optional deterministic content assertions.

The result must expose hard errors, advisory warnings, and blind spots
separately.

### Eval

`my-mate eval <run_id> [--evaluator <id>] [--json]`

Evaluation combines, but does not collapse:

- Pipeline verdict.
- Contract verdict.
- Evidence completeness.
- Usage/cost completeness.
- Optional semantic evaluator verdict.

Semantic evaluator modes:

- `none`: quality is `not_evaluated`.
- `deterministic`: schema/rule/rubric code with no model.
- `model`: a separately configured judge with model and prompt version stored.

### Trace

`my-mate trace <run_id> [--node <node_id>] [--json]`

Trace reads first-class evidence, not chat text heuristics. Normalize evidence
into spans:

```ts
interface TraceSpan {
  span_id: string;
  parent_span_id: string | null;
  run_id: string;
  node_run_id: string;
  job_id: string;
  kind: "model" | "tool" | "handoff" | "artifact" | "control";
  name: string;
  status: "ok" | "error" | "unknown";
  started_at: string;
  finished_at: string | null;
  input_ref: string | null;
  output_ref: string | null;
  usage: UsageSummary | null;
}
```

### Replay

Do not use one word for three different operations:

- `my-mate replay <run_id>`: rebuild and verify runtime state from events.
- `my-mate replay-plan <run_id>`: categorize failures and propose changes.
- `my-mate rerun <run_id>`: create a new run with the same immutable route and
  inputs, recording `source_run_id`.

Provider output cannot be deterministically reproduced unless the harness is
deterministic. The CLI must state this explicitly.

## Provider-Native Evidence

The shared protocol already declares `tool_call`, `tool_result`, and `usage`,
but current command harnesses capture aggregate stdout and Manager Client emits
generic model-text records from progress reports. The missing piece is a
streaming harness contract.

```ts
interface HarnessClient {
  execute(
    job: RuntimeWorkerJob,
    emit: (event: HarnessEvidenceEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<HarnessResult>;
}
```

Provider adapters normalize native streams:

- Codex: response items, function calls/results, usage.
- Claude SDK: assistant blocks, tool use/result blocks, final usage.
- Kimi: native stream events and usage.
- OpenClaw: bridge events/callbacks mapped at the harness boundary.
- Local deterministic: explicit synthetic source and
  `usage_available=false`.

Extend evidence with:

- provider and model.
- sequence and native event id.
- span id and parent span id.
- tool call id and tool name.
- input/output references.
- input/output/cache tokens.
- duration and turn count.
- provider-reported cost when available.

Cost rules:

- Unknown usage or price produces null, never zero.
- Server-side pricing estimates record catalog id/version.
- Provider-reported and estimated cost are separate fields.
- Secrets and sensitive tool inputs are redacted before transport.

Tests use recorded provider fixtures. Live-key integration tests are opt-in and
must not be required for normal CI.

## Graph-First Runtime UX

HomeRail's runtime canvas uses topological depth for initial columns, then a
small force simulation for spacing. Nodes carry status, tool, failure, and
token badges; selection opens a detail drawer.

My Mate already has a topological SVG layout in the template authoring view.
Extract that model instead of introducing a second graph algorithm:

```text
buildDagLayout(nodes, edges)
  -> authoring graph
  -> route compare graph
  -> runtime graph
```

Runtime view requirements:

- The spatial DAG is the primary completed and running view.
- Stable left-to-right columns for topological depth.
- Parallel branches share a column and never overlap.
- Edge labels show port/condition; active handoffs animate subtly.
- Node badges show status, attempts, tool failures, tokens, and duration.
- Selecting a node opens a right drawer with job/worker/lease, prompt, tool
  calls/results, usage, handoffs, artifacts, and errors.
- Run controls and five summary metrics stay in a compact toolbar.
- Mission timeline, route comparison, and raw evidence remain secondary tabs.
- Mobile uses a compact topological timeline, not a shrunk desktop canvas.

Prefer deterministic SVG/HTML layout for the first release. Add pan/zoom and a
minimap only after branch and large-graph fixtures pass. HomeRail's continuous
physics should not be copied unless static layout proves insufficient.

Visual acceptance fixtures:

- Two-node linear run.
- Parallel fan-out/fan-in.
- Conditional success/failure branches.
- Waiting-human node.
- Failed node with retry.
- At least 20 nodes.

Verify at desktop and mobile viewports with screenshots and overlap checks.

## Implementation Order

### Slice A: Runtime Truth (P0)

1. Add `RunRouteSnapshot` and read-time legacy synthesis.
2. Make direct template runs project a route and work packages.
3. Add `RunEvidenceSnapshot` and digest.

Exit: all run creation paths expose the same route and evidence contract.

### Slice B: Operator Minimum Loop (P0)

1. Add doctor and supervise APIs.
2. Add `@my-mate/cli` with doctor, run, and supervise.
3. Add pipeline scorecard with persisted result.

Exit: the real two-node Docker smoke is runnable and diagnosable entirely from
CLI, with model readiness reported separately.

### Slice C: Evaluation And Replay (P1)

1. Add declarative scorecard policy and enforcement.
2. Add persisted eval, trace, audit replay, replay-plan, and rerun APIs.
3. Add CLI commands and Studio result tabs.

Exit: a terminal run produces explicit pipeline, contract, evidence, and
quality verdicts without conflating them.

### Slice D: Provider Evidence (P1)

1. Introduce streaming Harness Client events.
2. Implement Codex, Claude SDK, Kimi, and OpenClaw fixture adapters.
3. Build trace spans and real usage/cost projections.

Exit: provider fixture runs expose ordered tool calls/results and usage; missing
data remains explicitly unavailable.

### Slice E: Graph-First UX (P1)

1. Extract shared DAG layout.
2. Replace stacked runtime rows with the spatial graph as primary surface.
3. Move rich evidence into node drawer and secondary tabs.
4. Run visual acceptance fixtures.

Exit: topology and current state are understandable without scanning the
Mission Workspace ledger.

## Release Gate

The four gaps were closed after the acceptance flow demonstrated:

1. `my-mate doctor --docker` reports runtime ready and model readiness
   independently.
2. A confirmed and a direct-template run both have canonical routes and work
   packages.
3. `supervise` reaches terminal status with no active jobs/workers/leases.
4. `scorecard` reports pipeline and contract results.
5. `eval` reports semantic quality as PASS/FAIL or explicitly not evaluated.
6. `trace` shows real provider tool/usage evidence, or explicitly marks it
   unavailable for deterministic harnesses.
7. `replay` reconstructs state, and `rerun` creates a linked new run.
8. Studio opens on a non-overlapping spatial DAG with node evidence drilldown.

All eight gates now pass through the deterministic Docker acceptance flow,
recorded native-provider fixtures, and Studio visual fixtures. Live provider
and model-judge verification remains an explicit credentialed gate and is not
implied by the offline acceptance result.
