# HomeRail-like Runtime Rewrite Closure Record

Status: baseline completed and verified.

Last synchronized: 2026-07-12.

This document records the completed Runtime rewrite that was originally tracked
as `HRR-0` through `HRR-7`. The authoritative current backlog is
`docs/19-progress-tracking-checklist.md`; detailed P0/P1 acceptance criteria are
in `docs/27-p0-p1-implementation-blueprint.md`.

## Goal

The rewrite replaced the product's OpenClaw-shaped execution mainline with a
provider-neutral runtime boundary:

```text
Control Plane Manager
  -> RuntimeEngine
  -> RuntimeDispatcher
  -> NodeProvisioner
  -> RuntimeWorker
  -> HarnessClient(openclaw/local/codex/claude-sdk/kimi)
```

OpenClaw remains a supported harness backend and compatibility bridge. It is no
longer the product runtime architecture or the canonical product vocabulary.

## Architecture Invariants

- [x] `RuntimeEngine` owns Worker-driven DAG runtime transitions.
- [x] `RuntimeWorkerJob` is the canonical dispatch input for new execution.
- [x] `WorkerEvent` and normalized execution reports are the accepted Worker
  output contracts.
- [x] `NodeProvisioner` owns Worker supply, isolation, and Docker lifecycle.
- [x] `RuntimeWorker` owns harness execution.
- [x] Worker registration, leases, jobs, events, controls, and recovery state
  have persisted transport contracts.
- [x] Runtime event application is idempotent under duplicate delivery.
- [x] Active jobs, leases, containers, cleanup attempts, and compensation work
  can recover after process restart.
- [x] Secrets are injected at Worker runtime and are redacted from persisted
  jobs, events, logs, evidence, and Docker diagnostics.
- [x] Product-facing code uses provider-neutral runtime identities.
- [x] Studio and Mobile consume normalized graph, evidence, trace, evaluation,
  usage, cost, and recovery projections.

## Phase Closure

| Phase | Status | Delivered exit state |
| --- | --- | --- |
| `HRR-0` | Done | Generic runtime identity, protocol, dispatch, provisioner, schema, and compatibility baseline. |
| `HRR-1` | Done | Dedicated `RuntimeEngine` owns scheduler transitions and report application. |
| `HRR-2` | Done | New dispatch mainline emits persisted `RuntimeWorkerJob` records instead of directly invoking the legacy adapter. |
| `HRR-3` | Done | Runtime Worker executes local, command, bridge, and provider-normalized harness jobs. |
| `HRR-4` | Done | Docker Worker provisioning, capacity, queueing, isolation, health gating, cleanup, and real daemon smoke coverage. |
| `HRR-5` | Baseline Done | Handoff ports, branch selection, skipped untaken branches, and evidence projection are implemented. Structured expression evaluation and failure-port recovery remain advanced follow-up semantics. |
| `HRR-6` | Done | OpenClaw is a selectable harness/legacy bridge behind provider-neutral contracts. |
| `HRR-7` | Done | Studio and Mobile expose graph state, Worker identity, evidence, artifacts, human gates, trace, replay, and evaluation. |

## Delivered Runtime Path

### Manager And Scheduler

- Persisted Run, node-run, runtime job, Worker lease, handoff, evidence, and
  recovery records.
- Deterministic ready-frontier scheduling with global capacity and queue
  behavior.
- Idempotent Worker event application with ordered accepted, progress,
  handoff, completed, failed, and control events.
- Pause, resume, cancel, skip, retry, node insertion, and parallelism changes.
- Restart recovery for queued/running jobs, stale leases, cleanup, compensation,
  and failure replay dispatch.

### Worker And Provisioning

- Runtime Worker HTTP and Worker-initiated WebSocket execution paths.
- Local, command, bridge, Codex, Claude SDK, Kimi, and OpenClaw evidence
  normalization paths.
- Docker container creation with CPU, memory, PID, timeout, mount, environment,
  and security policy controls.
- Global Worker capacity, FIFO queueing, queue timeout/cancellation, health
  gating, durable cleanup, inventory reconciliation, and orphan removal.
- Deterministic Docker smoke coverage, including recovery and OC-02 timeout/
  replay scenarios.

### Handoff And Evidence

- Provider-neutral `NodeHandoff` records with source/target ports and branch
  projection.
- Evidence Protocol V2 with redaction, payload references, native tool calls,
  tool results, usage, provider cost, estimated cost, and unavailable states.
- Untaken branches are projected as skipped rather than failed.
- Trace, pure replay, projection diff, replay plan, linked rerun, scorecard, and
  independent evaluation records.

### Product Surfaces

- CLI operator loop: `doctor -> run -> supervise -> scorecard -> eval -> replay
  -> trace`.
- Studio spatial runtime graph with deterministic layout, node drawer, evidence,
  evaluation, cost, recovery, and failure replay controls.
- Mobile staged topology, full-height evidence, trace, replay, evaluation, and
  human-gate actions.
- Shared OpenAPI contracts, generated types, Gateway routes, and compatibility
  reads for historical records.

## Scope That Remains

These are new follow-up slices, not unfinished prerequisites for the completed
HomeRail P0/P1 baseline.

### Production Release Engineering

- [ ] Replace `my-mate-runtime-worker:latest` defaults with immutable release
  tags/digests and expose build provenance.
- [ ] Add CI release gates for generated-contract drift, checks, tests, image
  build, deterministic Docker smoke, and runtime-mode readiness.
- [ ] Add SBOM, signing, vulnerability policy, upgrade, and rollback procedures.

### Advanced Runtime Semantics

- [ ] Evaluate structured edge-condition expressions.
- [ ] Route matching failure ports to recovery nodes without terminal Run
  failure.
- [ ] Add Worker-native human-gate suspend/resume.
- [ ] Add dynamic fanout cardinality.
- [ ] Finish harness-specific control guarantees and control-during-
  provisioning tests.

### Product And Projection Depth

- [ ] Add a full direct-manipulation Studio DAG editor; the current editor is a
  form-backed graph skeleton with a strong runtime graph.
- [ ] Add an independently rebuildable evented Mission/Session materializer.
- [ ] Add opt-in live provider and real model-judge release acceptance lanes.
- [ ] Complete deferred Mobile notifications, production authentication, and
  offline/weak-network behavior.

## Verification

The closure baseline is guarded by:

- `npm run check`
- `npm test`
- `npm run runtime-worker:image`
- `npm run runtime-worker:smoke`
- `npm run runtime-worker:recovery-smoke`
- `npm run runtime-worker:oc02-smoke`
- Studio desktop and mobile-width runtime graph acceptance fixtures.

On 2026-07-11, `npm run check` and `npm test` passed after the DATA-03, OBS-02,
and OC-02 closure. Live provider tests remain explicit opt-in checks.

## Related Documents

- `docs/19-progress-tracking-checklist.md`
- `docs/22-homerail-like-runtime-architecture.md`
- `docs/24-homerail-like-runtime-contract-v1.md`
- `docs/25-homerail-human-flow-comparison.md`
- `docs/26-homerail-gap-closure-plan.md`
- `docs/27-p0-p1-implementation-blueprint.md`
- `docs/31-oc-02-timeout-compensation-failure-replay.md`
