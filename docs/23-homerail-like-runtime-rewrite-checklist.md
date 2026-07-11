# HomeRail-like Runtime Rewrite Checklist

Status: active tracking document.

This checklist implements the direction in
`docs/22-homerail-like-runtime-architecture.md`.

The fixed runtime boundary contract is
`docs/24-homerail-like-runtime-contract-v1.md`.

The goal is a root runtime rewrite:

```text
Control Plane Manager
  -> RuntimeEngine
  -> RuntimeDispatcher
  -> NodeProvisioner
  -> RuntimeWorker
  -> HarnessClient(openclaw/local/codex/claude-sdk/kimi)
```

OpenClaw remains useful, but it must become a harness backend. It must not be
the product runtime architecture.

## Tracking Rules

- Keep every task id stable once created.
- Mark a task done only after code, schema, tests, and docs are aligned.
- Each phase should end with a runnable system, even if some backends are still
  stubbed.
- Existing OpenClaw/local behavior may be kept during cutover, but new mainline
  code must point toward `RuntimeEngine -> RuntimeWorkerJob -> WorkerEvent`.
- Do not expand a phase into unrelated product/UI work unless the task is listed
  here or added explicitly.

Status labels:

- `Todo`: not started.
- `Doing`: actively being changed.
- `Blocked`: waiting on a dependency or decision.
- `Done`: implemented and verified.
- `Legacy`: kept only for compatibility during cutover.

## Architecture Invariants

- [x] `RuntimeEngine` owns Worker-driven DAG runtime transitions.
- [x] `RuntimeWorkerJob` is the only dispatch input for new runtime execution.
- [x] `WorkerEvent` and `NormalizedExecutionReport` are the only accepted worker
      outputs.
- [x] `NodeProvisioner` owns worker supply and Docker lifecycle.
- [x] `RuntimeWorker` owns harness execution.
- [x] Worker registration, job delivery, event delivery, and control delivery
      have explicit transport contracts.
- [x] Runtime event application is idempotent and safe under duplicate delivery.
- [x] Worker leases and active jobs are recoverable after process restart.
- [x] Secrets are injected only at worker runtime and are not persisted in job
      envelopes, events, logs, or evidence.
- [x] Product-facing code uses `runtime_agent_ref`, `agent_runtime`, and
      `harness_profile`.
- [x] `openclaw_*` fields are compatibility or raw-runtime fields only.
- [x] Studio and Mobile consume normalized runtime projections, not provider
      internals.

## Phase Overview

| Phase | Status | Goal | Main Exit Gate |
| --- | --- | --- | --- |
| `HRR-0` | Done | Runtime semantic baseline | Generic runtime fields and protocol skeleton exist |
| `HRR-1` | Doing | Extract `RuntimeEngine` | `app.ts` no longer owns DAG state transitions |
| `HRR-2` | Done | Make `RuntimeWorkerJob` the dispatch mainline | New dispatch path no longer calls `ExecutionAdapter` directly |
| `HRR-3` | Implemented | Add `services/runtime-worker` | Worker executes local, command, and bridge harness jobs |
| `HRR-4` | Implemented | Add Docker worker provisioning | Automated tests pass; real Docker daemon smoke is pending |
| `HRR-5` | Doing | Add handoff-driven DAG routing | Port routing and branch skipping work; condition evaluation remains |
| `HRR-6` | Doing | Demote OpenClaw to harness | Canonical runtime fields exist; legacy bridge remains supported |
| `HRR-7` | Implemented | Add HomeRail-like runtime UI projection | Studio/Mobile show graph, evidence, artifacts, handoffs |

## HRR-0 Runtime Semantic Baseline

Status: Done.

Purpose: establish generic runtime language before replacing the execution
mainline.

Completed tasks:

- [x] Add `runtime_agent_ref`, `agent_runtime`, and `harness_profile` to agent
      profile semantics.
- [x] Add `agent_runtime` and `harness_profile` to compiled nodes.
- [x] Add `agent_runtime` and `harness_profile` to `DispatchEnvelope`.
- [x] Keep OpenClaw fields as compatibility aliases.
- [x] Add execution adapter registry skeleton.
- [x] Add deferred `codex`, `claude-sdk`, and `kimi` adapter entries.
- [x] Add `runtime-protocol.ts` with `RuntimeWorkerJob`, `WorkerEvent`,
      `NodeHandoff`, and `WorkerLease`.
- [x] Add `runtime-dispatcher.ts` with `RuntimeDispatcher` and
      `ExecutionAdapterRuntimeDispatcher`.
- [x] Add `node-provisioner.ts` with local and deferred Docker provisioners.
- [x] Update `run-plan.schema.json`.
- [x] Add runtime protocol tests.
- [x] Verify `npm --prefix services/control-plane run check`.
- [x] Verify `npm --prefix services/control-plane test`.

Remaining cleanup:

- [ ] Add explicit data migration notes for historical run plans that do not
      contain `agent_runtime` or `harness_profile`.
- [x] Fix provider-neutral `ExecutionRefV2` target shape.

## HRR-1 Extract RuntimeEngine

Status: Doing.

Purpose: move DAG execution truth out of `app.ts` and into a dedicated manager
runtime module.

Target files:

- `services/control-plane/src/runtime/runtime-engine.ts`
- `services/control-plane/src/runtime/runtime-state.ts`
- `services/control-plane/src/runtime/runtime-events.ts`
- `services/control-plane/src/runtime/runtime-report.ts`
- `services/control-plane/src/app.ts`
- `services/control-plane/test/runtime-engine.test.ts`

Tasks:

- [x] Create `RuntimeEngine` constructor with dependencies injected for stores,
      event appenders, dispatcher, and clock.
- [ ] Implement the `RuntimeEngine` public API fixed in
      `docs/24-homerail-like-runtime-contract-v1.md`.
- [x] Move `queueReadyNodes(runId)` behavior into
      `RuntimeEngine.queueReadyNodes(runId)`.
- [x] Move ready frontier scan, max parallelism, active dispatch counting, and
      end-node completion into RuntimeEngine.
- [x] Move node dispatch event writing into RuntimeEngine.
- [x] Rename callback logic from `applyOpenClawCallback` to generic
      `applyExecutionReport`.
- [x] Move report handling for `accepted`, `running`, `waiting_human`,
      `completed`, `failed`, and `cancelled` into RuntimeEngine.
- [x] Keep approvals and human input creation in RuntimeEngine or a runtime gate
      helper, not in API routes.
- [x] Keep `app.ts` routes as thin wrappers that call RuntimeEngine.
- [x] Preserve existing callback endpoint path for compatibility, but make it
      call `RuntimeEngine.applyExecutionReport`.
- [x] Add unit tests for initial ready dispatch.
- [x] Add unit tests for parallelism limits.
- [x] Add unit tests for completed node downstream unlock.
- [x] Add unit tests for waiting human gate creation.
- [x] Add unit tests for failed/cancelled terminal states.
- [ ] Add unit tests for end-node completion without worker dispatch.

Exit criteria:

- [ ] `app.ts` does not directly own ready/running/completed/failed node state
      transitions.
- [x] `queueReadyNodes` is removed from `app.ts` or reduced to a wrapper.
- [x] `applyOpenClawCallback` naming no longer appears in runtime semantics.
- [x] Existing control-plane tests pass.

Verification:

- [x] `npm --prefix services/control-plane run check`
- [x] `npm --prefix services/control-plane test`

## HRR-2 Make RuntimeWorkerJob The Dispatch Mainline

Status: Done.

Purpose: replace direct `ExecutionAdapter.dispatchNode(envelope)` calls with
`RuntimeDispatcher.dispatchJob(RuntimeWorkerJob)`.

Target files:

- `services/control-plane/src/runtime/runtime-engine.ts`
- `services/control-plane/src/runtime-dispatcher.ts`
- `services/control-plane/src/runtime-protocol.ts`
- `services/control-plane/src/execution-adapter.ts`
- `services/control-plane/src/execution-adapter-factory.ts`
- `services/control-plane/src/adapter-contracts.ts`
- `services/control-plane/test/runtime-dispatcher.test.ts`

Tasks:

- [x] Build `RuntimeWorkerJob` inside RuntimeEngine for every dispatchable node.
- [x] Use the fixed `RuntimeWorkerJob v1` job id format and semantic fields.
- [x] Persist `RuntimeJobRecord` for every dispatch attempt.
- [x] Replace direct adapter dispatch with `RuntimeDispatcher.dispatchJob(job)`.
- [x] Keep `ExecutionAdapterRuntimeDispatcher` only as a cutover bridge.
- [x] Add dispatch event payload fields:
      `job_id`, `target_kind`, `agent_runtime`, `runtime_agent_ref`.
- [x] Add a runtime dispatch result model that does not require OpenClaw task or
      session ids.
- [x] Add provider-neutral execution reference shape.
- [x] Keep OpenClaw raw refs under compatibility/raw metadata.
- [x] Update `/health` and `/api/runtime/summary` to show runtime dispatcher and
      provisioner status.
- [x] Add tests that assert `codex`, `claude-sdk`, and `kimi` jobs target
      `docker-worker`.
- [x] Add tests that assert OpenClaw jobs target `external-bridge` only through
      the legacy bridge.

Exit criteria:

- [x] New runtime path dispatches `RuntimeWorkerJob`, not bare
      `DispatchEnvelope`.
- [x] `ExecutionAdapter` is marked `Legacy` in docs/comments or moved behind a
      legacy dispatcher.
- [x] OpenClaw task/session ids are no longer required for dispatch acceptance.

Verification:

- [x] `npm --prefix services/control-plane run check`
- [x] `npm --prefix services/control-plane test`
- [ ] Existing OpenClaw bridge smoke remains runnable through the legacy path.

## HRR-3 Add RuntimeWorker Service

Status: Implemented. Provider-native streaming tool events remain follow-up work.

Purpose: introduce the actual worker runtime process that receives jobs,
executes harness clients, and emits normalized worker events.

Target files/directories:

- `services/runtime-worker/package.json`
- `services/runtime-worker/src/server.ts`
- `services/runtime-worker/src/worker-runtime.ts`
- `services/runtime-worker/src/harness/factory.ts`
- `services/runtime-worker/src/harness/local.ts`
- `services/runtime-worker/src/harness/openclaw.ts`
- `services/runtime-worker/src/dag-tools/`
- `services/control-plane/src/runtime-worker-client.ts`

Tasks:

- [x] Create `services/runtime-worker`.
- [x] Add worker WebSocket registration endpoint using the fixed runtime
      transport contract.
- [x] Add job receive/ack flow.
- [x] Implement fixed `job.ack` statuses and duplicate handling.
- [x] Add `WorkerEvent` emitter client back to control-plane.
- [x] Include `idempotency_key` and `sequence` on every worker event.
- [x] Implement `local` harness client.
- [x] Implement `openclaw` harness client using current bridge capability.
- [x] Add command harness clients for `codex`, `claude-sdk`, and `kimi`.
- [x] Emit normalized progress reports.
- [x] Persist harness output as an artifact.
- [x] Emit normalized node handoffs.
- [ ] Add worker-level `request_human_input` tool.
- [x] Persist worker evidence logs per node.
- [x] Add worker tests for local harness success.
- [ ] Add worker tests for failed harness normalization.
- [ ] Add worker tests for tool event emission.

Exit criteria:

- [x] A local worker can execute a runtime job and report completion.
- [x] OpenClaw can be reached through worker harness code, not product route
      code.
- [x] Worker output is only `WorkerEvent` / `NormalizedExecutionReport`.

Verification:

- [x] `npm --prefix services/runtime-worker run check`
- [x] `npm --prefix services/runtime-worker test`
- [x] `npm --prefix services/control-plane test`

## HRR-4 Add Docker Worker Provisioning

Status: Implemented. Real Docker daemon smoke is environment-pending.

Purpose: make Docker worker supply a first-class runtime layer like HomeRail's
Node/worker-provisioner path.

Target files:

- `services/control-plane/src/node-provisioner.ts`
- `services/control-plane/src/runtime/worker-lease-store.ts`
- `services/control-plane/src/runtime/docker-worker-provisioner.ts`
- `services/runtime-worker/Dockerfile`
- `docker-compose.yml`
- `scripts/start-runtime-worker.mjs`

Tasks:

- [x] Implement `DockerWorkerProvisioner`.
- [x] Add worker lease persistence.
- [x] Persist `WorkerLeaseRecord` using the fixed v1 fields.
- [x] Add lease fields:
      `lease_id`, `worker_id`, `job_id`, `container_id`, `target_kind`,
      `acquired_at`, `expires_at`, `released_at`, `status`.
- [x] Implement worker image build.
- [x] Pass env into worker:
      `AGENT_BACKEND`, `MY_MATE_RUN_ID`, `MY_MATE_NODE_RUN_ID`,
      `MY_MATE_WORKSPACE_ID`, `MY_MATE_RUNTIME_AGENT_REF`,
      `MY_MATE_MANAGER_WS_URL`.
- [ ] Support provisioning lifecycle events:
      `worker.provisioning_requested`,
      `worker.provisioning_completed`,
      `worker.provisioning_failed`.
- [x] Dispatch job only after worker is connected and lease is ready.
- [x] Release worker after terminal event.
- [x] Add cleanup for failed, stale, rejected, and recovered containers.
- [x] Add bounded retry policy for Worker and provisioning failures.
- [ ] Add health endpoint for Docker provisioner status.
- [x] Add integration smoke script for one local Docker worker run.

Exit criteria:

- [ ] A `docker-worker` job starts a container, connects a worker, executes a
      job, reports completion, and releases the lease.
- [x] Provisioning failure is visible as runtime/provisioning failure, not as a
      generic OpenClaw failure.
- [x] Manager code does not directly embed Docker execution details outside the
      provisioner.

Verification:

- [x] `npm --prefix services/control-plane test`
- [x] `npm --prefix services/runtime-worker test`
- [ ] Docker worker smoke script passes locally.

## HRR-5 Add Handoff-Driven DAG Routing

Status: Doing. Port routing is implemented; condition evaluation remains.

Purpose: replace simple completed-node downstream unlock with HomeRail-like
handoff routing by port and condition.

Target files:

- `schemas/workflow/workflow-edge.schema.json`
- `schemas/workflow/run-plan.schema.json`
- `services/control-plane/src/node-scheduler.ts`
- `services/control-plane/src/runtime/runtime-engine.ts`
- `services/control-plane/src/runtime-protocol.ts`
- `services/runtime-worker/src/dag-tools/handoff.ts`
- `services/control-plane/test/runtime-handoff.test.ts`

Tasks:

- [x] Add or normalize edge fields:
      `from_port`, `to_port`, `condition`.
- [ ] Adopt fixed default ports:
      `success`, `failure`, `rejected`, `cancelled`.
- [x] Add `NodeHandoff` persistence or event projection.
- [x] Implement `RuntimeEngine.applyNodeHandoff(handoff)`.
- [ ] Route downstream nodes by `from_port` and edge condition. Port routing is implemented; structured condition evaluation remains.
- [x] Preserve completed-node unlock as compatibility only for nodes that do not
      emit handoff.
- [ ] Support failure port routing without terminal run failure when a matching
      recovery edge exists.
- [x] Support skipped untaken branches.
- [x] Add tests for success handoff.
- [ ] Add tests for failure handoff to recovery node.
- [ ] Add tests for custom port routing.
- [ ] Add tests for missing matching port behavior.

Exit criteria:

- [ ] A node can choose its downstream path by calling `handoff`.
- [ ] Failed work can route to recovery nodes.
- [ ] Completed status no longer blindly unlocks every downstream edge when
      explicit handoff ports exist.

Verification:

- [ ] `npm --prefix services/control-plane run check`
- [ ] `npm --prefix services/control-plane test`
- [ ] `npm --prefix services/runtime-worker test`

## HRR-6 Demote OpenClaw To Harness

Status: Doing.

Purpose: remove OpenClaw from product/runtime semantics while preserving it as
one harness backend.

Target files:

- `services/runtime-worker/src/harness/openclaw.ts`
- `services/execution-adapter/`
- `services/control-plane/src/openclaw-execution-adapter.ts`
- `services/control-plane/src/adapter-contracts.ts`
- `schemas/agent/agent-profile.schema.json`
- `schemas/workflow/run-plan.schema.json`
- `apps/studio/src/app.js`
- `apps/mobile/lib/types.ts`
- `apps/mobile/lib/task-thread.ts`

Tasks:

- [ ] Create `OpenClawHarnessClient`.
- [ ] Move OpenClaw dispatch/control details behind the harness client.
- [ ] Mark `OpenClawExecutionAdapter` as legacy.
- [ ] Remove product requirement for `openclaw_agent_id` in new agent profiles.
- [ ] Keep read-time compatibility for historical profiles and run plans.
- [ ] Update schema so `runtime_agent_ref` is canonical.
- [ ] Move OpenClaw task/session refs into raw execution metadata.
- [ ] Update Studio labels from OpenClaw agent to runtime agent/harness.
- [ ] Update Mobile labels from OpenClaw agent to runtime agent/harness.
- [ ] Update docs that still call OpenClaw the execution kernel.
- [ ] Add migration notes for existing stored profiles.

Exit criteria:

- [ ] New My Mate profiles can be created without OpenClaw-specific fields.
- [ ] Removing OpenClaw config does not break local/runtime-worker execution.
- [ ] OpenClaw remains selectable as `agent_runtime = openclaw`.

Verification:

- [ ] `npm --prefix services/control-plane test`
- [ ] `npm --prefix apps/studio run check`
- [ ] `npm --prefix apps/mobile run check`
- [ ] `npm --prefix apps/mobile test`

## HRR-7 Add Agent UI Runtime Projection

Status: Implemented. Live updates currently use the existing refresh and polling paths.

Purpose: adapt HomeRail `agent-ui` patterns into My Mate Studio/Mobile without
copying the product shell wholesale.

Target files:

- `services/control-plane/src/runtime-graph.ts`
- `services/control-plane/src/event-store.ts`
- `services/control-plane/src/app.ts`
- `apps/studio/src/app.js`
- `apps/studio/src/styles.css`
- `apps/mobile/lib/task-thread.ts`
- `apps/mobile/app/tasks/[sessionId].tsx`

Tasks:

- [x] Add runtime event projection API for active mission/session/run.
- [ ] Add live event stream or improve existing session stream for runtime
      events.
- [x] Add per-node evidence projection:
      prompts, tool calls, handoffs, artifacts, errors.
- [x] Add Studio runtime inspector views:
      graph, selected node, evidence, artifacts, handoffs, logs.
- [x] Add Studio full-screen runtime graph mode.
- [x] Add Mobile compact runtime timeline and per-node runtime details.
- [x] Keep conversation rail separate from runtime inspector.
- [x] Add tests for projection shape.
- [ ] Run browser visual checks for Studio if UI changes are substantial.

Exit criteria:

- [ ] A user can inspect which worker/harness ran each node.
- [ ] A user can see node evidence and artifacts without reading raw events.
- [ ] Runtime events update the graph/timeline without losing conversation
      context.

Verification:

- [ ] `npm --prefix services/control-plane test`
- [ ] `npm --prefix apps/studio run check`
- [ ] `npm --prefix apps/mobile run check`
- [ ] `npm --prefix apps/mobile test`

## Cross-Cutting Work

Known omissions to implement:

- [x] Fix the Manager/Worker transport contract.
      Target: worker-initiated WebSocket primary, HTTP callback fallback for
      legacy adapters only.
- [x] Fix worker registration and heartbeat semantics.
- [x] Fix job ack semantics:
      accepted, rejected, lease expired, duplicate job, worker busy.
- [x] Fix event idempotency keys for every `WorkerEvent`.
- [x] Fix event ordering rules for accepted/progress/handoff/terminal events.
- [x] Fix stale worker and orphaned container recovery.
- [x] Fix process restart recovery:
      active run, active node, active worker lease, active job.
- [ ] Add full event-sourced replay and scorecard commands. Startup recovery currently uses persisted run, job, lease, and handoff state.
- [x] Fix provider-neutral `ExecutionRef` before removing OpenClaw refs.
- [x] Fix artifact ownership:
      worker-local file, bridge URI, object store URI, repo path, or inline
      summary.
- [ ] Complete provider-native evidence streaming for tool calls, tool results, and usage. Prompts, model text, handoffs, artifacts, and errors are persisted now.
- [x] Fix secrets handling:
      model API keys, OpenClaw tokens, workspace credentials, Docker env.
- [x] Support shared project mounts and per-run workspaces. Per-job copy and remote workspace modes remain future work.
- [ ] Complete resource policy. CPU, memory, PID hints, parallelism, timeout, and retry budgets exist; global worker limits and queue backpressure remain.
- [ ] Fix control action behavior while provisioning:
      pause, cancel, retry, skip before worker is connected.
- [ ] Complete control action behavior while harness is running:
      pause/resume/cancel support per harness.
- [ ] Add Worker-native human gate suspend/resume. Manager-side approval and node requeue already work.
- [x] Fix handoff compatibility behavior for old templates without ports.
- [x] Fix projection contract shared by Studio, Mobile, and event stream.
- [ ] Implement Docker image build and versioning policy for runtime workers.
- [x] Implement local development workflow:
      local worker, Docker worker, legacy OpenClaw bridge.
- [ ] Implement release gates for each runtime mode.
- [x] Implement `RuntimeSocketMessageBase` and worker WebSocket message types.
- [x] Implement `RuntimeJobRecord`.
- [x] Implement `WorkerLeaseRecord`.
- [x] Implement `WorkerEvidenceRecord`.
- [x] Implement `NodeHandoffRecord`.
- [x] Implement `ExecutionRefV2` read/write compatibility.

Target flow diagrams:

- [x] Component flow recorded in
      `docs/22-homerail-like-runtime-architecture.md`.
- [x] Run launch and dispatch sequence recorded in
      `docs/22-homerail-like-runtime-architecture.md`.
- [x] Worker execution and event sequence recorded in
      `docs/22-homerail-like-runtime-architecture.md`.
- [x] Handoff routing sequence recorded in
      `docs/22-homerail-like-runtime-architecture.md`.
- [x] Human control sequence recorded in
      `docs/22-homerail-like-runtime-architecture.md`.
- [x] Runtime projection flow recorded in
      `docs/22-homerail-like-runtime-architecture.md`.

Data and schema:

- [ ] Add migration/read compatibility for records without `agent_runtime`.
- [ ] Add migration/read compatibility for records without `harness_profile`.
- [x] Implement provider-neutral `ExecutionRefV2`.
- [x] Implement worker lease persistence using the repo's active storage backend
      pattern, with JSON compatibility during the current storage cutover.
- [x] Add `RuntimeJobRecord` or equivalent persisted job model.
- [x] Add `WorkerLeaseRecord`.
- [x] Add `WorkerEvidenceRecord`.
- [x] Add `NodeHandoffRecord` or equivalent event projection.
- [x] Add schema compatibility for edge ports.

Observability:

- [ ] Add provisioning lifecycle events to the same idempotent event stream. Worker execution events already have ids and ordering.
- [x] Add job id to dispatch/progress/completion events.
- [x] Add worker id and lease id to node detail projections.
- [ ] Add provisioning failure dashboard signals.
- [x] Add runtime projection signals for stale leases.
- [x] Add runtime projection signals for duplicate/ignored events.
- [x] Add runtime signals for queue backlog and worker capacity.

Testing:

- [x] Keep current control-plane suite green after every phase.
- [x] Add runtime-engine focused tests before removing app-level behavior.
- [x] Add worker service tests before Docker provisioning.
- [x] Add Docker smoke only after local worker path is stable.
- [x] Add duplicate event replay tests.
- [x] Add restart recovery tests for active jobs and leases.
- [ ] Add control-during-provisioning tests.
- [x] Add Docker argument secret-redaction tests.

Docs:

- [ ] Update `docs/01-my-mate-overall-architecture.md` after HRR-2.
- [ ] Update `docs/02-my-mate-implementation-roadmap.md` after HRR-2.
- [ ] Update `docs/05-my-mate-interaction-architecture.md` after HRR-3.
- [ ] Update `docs/06-my-mate-openclaw-integration-plan.md` after HRR-6.
- [ ] Keep `docs/22-homerail-like-runtime-architecture.md` as architecture
      direction.
- [ ] Keep this file as the implementation tracker.

## Suggested Iteration Slices

### Slice 1: RuntimeEngine Skeleton

- [x] Create runtime folder and engine class.
- [x] Move `queueReadyNodes` without changing behavior.
- [x] Add runtime-engine tests around existing behavior.
- [x] Keep adapter dispatch unchanged.

### Slice 2: Generic Report Application

- [x] Rename OpenClaw callback handling to generic report handling.
- [x] Move report application into RuntimeEngine.
- [x] Keep callback route path stable.
- [x] Add tests for report statuses.

### Slice 3: Job Dispatch Cutover

- [x] Build `RuntimeWorkerJob` in RuntimeEngine.
- [x] Dispatch through `RuntimeDispatcher`.
- [x] Mark `ExecutionAdapter` as legacy bridge.
- [x] Add job fields to events.

### Slice 4: Local RuntimeWorker

- [ ] Add runtime-worker service.
- [ ] Implement local harness.
- [ ] Connect control-plane to worker.
- [ ] Run one node end to end through worker.

### Slice 5: OpenClaw Harness Through Worker

- [ ] Add OpenClaw harness client.
- [ ] Route OpenClaw execution through worker.
- [ ] Keep old bridge path as fallback only.
- [ ] Verify OpenClaw smoke.

### Slice 6: Docker Provisioner

- [ ] Add Docker worker image.
- [ ] Add lease store.
- [ ] Start worker container per isolated job.
- [ ] Release and cleanup workers.

### Slice 7: Handoff Routing

- [ ] Add edge ports.
- [ ] Add handoff tool and manager handler.
- [ ] Route success/failure/custom branches.
- [ ] Render handoff evidence.

## Current Next Task

The next implementation task should be `HRR-3 / Slice 4`:

```text
Create `services/runtime-worker` with the minimal local harness execution loop,
so a `RuntimeWorkerJob` can be accepted and completed through worker-shaped
code instead of staying inside the legacy adapter bridge.
```

This starts the runtime-worker service cutover. Docker worker provisioning,
handoff routing, and Agent UI should layer on top only after the worker service
can execute at least the local harness path end to end.
