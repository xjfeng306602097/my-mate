# HomeRail-like Runtime Contract v1

Status: fixed target contract for `HRR-1` through `HRR-6`.

This document fixes the runtime boundary decisions for the HomeRail-like rewrite.
Implementation may be incremental, but new runtime code should target this
contract instead of inventing local alternatives.

Related documents:

- `docs/22-homerail-like-runtime-architecture.md`
- `docs/23-homerail-like-runtime-rewrite-checklist.md`

## Contract Goals

- Control Plane owns DAG truth.
- Runtime workers own execution only.
- Harness clients own provider-specific behavior only.
- Manager/Worker communication is protocol-first and idempotent.
- OpenClaw is a harness backend, not the product runtime.

## Process Boundaries

```text
services/control-plane
  - HTTP API for Studio/Mobile/Gateway
  - RuntimeEngine
  - RuntimeDispatcher
  - NodeProvisioner
  - runtime stores
  - runtime projection API/stream

services/runtime-worker
  - worker WebSocket client/server adapter
  - RuntimeWorker
  - DAG tools
  - HarnessFactory
  - harness clients

Docker / remote node layer
  - starts isolated worker process
  - injects env/secrets
  - reports container/worker lifecycle

services/execution-adapter
  - legacy OpenClaw bridge only during cutover
```

## RuntimeEngine API

`RuntimeEngine` is the only runtime state machine.

Required public methods:

```ts
interface RuntimeEngine {
  queueReadyNodes(runId: string, reason?: RuntimeQueueReason): Promise<RuntimeQueueResult>;
  applyWorkerEvent(event: WorkerEvent): Promise<WorkerEventApplyResult>;
  applyExecutionReport(report: NormalizedExecutionReport, source: LegacyReportSource): Promise<WorkerEventApplyResult>;
  applyControlAction(action: RuntimeControlAction): Promise<RuntimeControlResult>;
  recoverActiveRuns(reason: RuntimeRecoveryReason): Promise<RuntimeRecoveryResult>;
}
```

Rules:

- `app.ts` routes call `RuntimeEngine`; they do not mutate node truth directly.
- `applyExecutionReport` exists only for legacy callbacks and immediately
  normalizes into `WorkerEvent` semantics.
- `queueReadyNodes` builds `DispatchEnvelope`, then `RuntimeWorkerJob`, then
  calls `RuntimeDispatcher.dispatchJob(job)`.
- RuntimeEngine writes run/node status, runtime events, artifacts, evidence
  projections, and downstream frontier changes.
- RuntimeEngine can notify active workers through RuntimeDispatcher, but worker
  control is best-effort. RuntimeEngine remains the source of truth.

## Transport Contract

Primary transport:

```text
ws(s)://{control-plane}/ws/runtime/workers/{worker_id}?token={runtime_worker_token}
```

Fallback transport:

```text
POST /api/runtime/worker-events
```

Fallback is for legacy adapters and emergency compatibility. New runtime workers
must use WebSocket as the primary channel.

Connection rules:

- Worker initiates the connection.
- Manager authenticates the worker token.
- Worker registers before receiving jobs.
- Worker sends heartbeat every 10 seconds.
- Manager treats a worker as stale after 30 seconds without heartbeat.
- Manager may close a worker connection after release, terminal job, or failed
  authentication.

## WebSocket Messages

Every message has:

```ts
interface RuntimeSocketMessageBase {
  protocol: "my_mate_runtime_v1";
  message_id: string;
  sent_at: string;
}
```

Worker to Manager:

```ts
type WorkerToManagerMessage =
  | WorkerRegisterMessage
  | WorkerHeartbeatMessage
  | JobAckMessage
  | WorkerEventMessage
  | WorkerEvidenceMessage;
```

Manager to Worker:

```ts
type ManagerToWorkerMessage =
  | WorkerRegisteredMessage
  | JobDispatchMessage
  | JobControlMessage
  | WorkerReleaseMessage
  | ProtocolErrorMessage;
```

Required message kinds:

| Direction | Kind | Purpose |
| --- | --- | --- |
| Worker -> Manager | `worker.register` | identify worker, capabilities, version |
| Manager -> Worker | `worker.registered` | confirm registration and heartbeat policy |
| Worker -> Manager | `worker.heartbeat` | keep lease/connection alive |
| Manager -> Worker | `job.dispatch` | send `RuntimeWorkerJob` |
| Worker -> Manager | `job.ack` | accepted/rejected/busy/duplicate |
| Worker -> Manager | `worker.event` | send `WorkerEvent` |
| Worker -> Manager | `worker.evidence` | send evidence refs or small evidence payloads |
| Manager -> Worker | `job.control` | pause/resume/cancel when supported |
| Manager -> Worker | `worker.release` | release worker/lease |
| Either | `protocol.error` | structured protocol error |

## Job Ack Semantics

`job.ack` statuses:

- `accepted`
- `rejected`
- `duplicate`
- `worker_busy`
- `lease_expired`
- `unsupported_runtime`
- `invalid_job`

Rules:

- A worker must send `job.ack` before `worker.progress`, `worker.handoff`, or a
  terminal event.
- Manager persists `accepted` as dispatch acceptance.
- `duplicate` is idempotent success if the active job id matches.
- `worker_busy`, `lease_expired`, `unsupported_runtime`, and `invalid_job` fail
  dispatch unless the job retry policy allows another provision/dispatch attempt.

## RuntimeWorkerJob v1

`RuntimeWorkerJob` is the only dispatch input for new execution.

Required semantic fields:

- `job_id`
- `run_id`
- `node_run_id`
- `node_id`
- `attempt`
- `envelope`
- `harness`
- `provision`
- `trace_context`
- `created_at`

Rules:

- `job_id` is stable for one dispatch attempt.
- `job_id` format should be:
  `{run_id}:{node_run_id}:attempt-{attempt}:dispatch-{dispatch_sequence}`.
- `DispatchEnvelope` remains inside the job for compatibility and context.
- Secrets must not be embedded in the job.
- Harness selection comes from `job.harness.agent_runtime`.

## WorkerEvent v1

Required common fields:

- `event_id`
- `idempotency_key`
- `sequence`
- `kind`
- `job_id`
- `run_id`
- `node_run_id`
- `worker_id`
- `created_at`

Supported event kinds:

- `worker.accepted`
- `worker.progress`
- `worker.handoff`
- `worker.waiting_human`
- `worker.completed`
- `worker.failed`
- `worker.cancelled`
- `worker.provisioning_requested`
- `worker.provisioning_completed`
- `worker.provisioning_failed`

Idempotency key:

```text
{run_id}:{node_run_id}:{job_id}:{sequence}:{kind}
```

Rules:

- Manager stores applied idempotency keys.
- Duplicate idempotency keys are ignored after returning the prior apply result.
- Events with lower or equal sequence than the last applied event for the same
  job are ignored unless the idempotency key matches a previously applied event.
- Non-terminal events after a terminal event are ignored and audited.
- A terminal event after a terminal event is ignored unless it is the same
  idempotency key.

## Event Ordering

Normal order:

```text
job.ack accepted
  -> worker.accepted
  -> worker.progress*
  -> worker.handoff?
  -> worker.waiting_human?
  -> worker.progress*
  -> worker.completed | worker.failed | worker.cancelled
```

Rules:

- `worker.accepted` may be synthesized by Manager from `job.ack accepted` for
  legacy adapters.
- `worker.handoff` may appear before terminal completion when a worker hands off
  and then finishes.
- `worker.waiting_human` pauses node execution until user input/approval is
  resolved.
- Terminal events close the active job unless RuntimeEngine explicitly requeues
  the node.

## Runtime Control Actions

Control actions:

- run-level: `pause`, `resume`, `cancel`
- node-level: `retry`, `skip`, `cancel`
- worker-level best effort: `pause`, `resume`, `cancel`

Rules:

- All user control enters through Control Plane.
- RuntimeEngine validates control actions against current run/node state.
- RuntimeEngine always writes an audit event for accepted/rejected controls.
- During provisioning:
  - `cancel` cancels lease/provisioning and marks node/run cancelled as needed.
  - `pause` prevents job dispatch after provisioning completes.
  - `retry` is queued until current provisioning is failed/cancelled.
  - `skip` cancels provisioning and marks node skipped if graph rules allow.
- During harness execution:
  - Manager sends `job.control` to worker if the harness supports it.
  - If a harness does not support pause/resume, RuntimeEngine records the
    control limitation and keeps DAG truth consistent.

## Handoff Contract

`NodeHandoff` fields:

- `type = "node_handoff"`
- `run_id`
- `node_run_id`
- `node_id`
- `job_id`
- `port`
- `content`
- `summary`
- `created_at`

Default ports:

- `success`
- `failure`
- `rejected`
- `cancelled`

Rules:

- New templates should use edge fields `from_port`, `to_port`, and `condition`.
- Existing templates without ports use legacy completed-node dependency unlock.
- A matching failure/rejected edge routes to recovery instead of failing the
  whole run.
- Missing matching failure/rejected edge fails the node and may fail the run.
- Untaken explicit branches may be marked skipped after all required upstream
  dependencies are resolved.

## Records To Persist

### RuntimeJobRecord

Fields:

- `job_id`
- `run_id`
- `node_run_id`
- `attempt`
- `dispatch_sequence`
- `status`
- `worker_id`
- `lease_id`
- `target_kind`
- `agent_runtime`
- `runtime_agent_ref`
- `created_at`
- `accepted_at`
- `finished_at`
- `last_event_id`
- `last_error`

### WorkerLeaseRecord

Fields:

- `lease_id`
- `worker_id`
- `job_id`
- `run_id`
- `node_run_id`
- `target_kind`
- `container_id`
- `status`
- `acquired_at`
- `last_heartbeat_at`
- `expires_at`
- `released_at`
- `release_reason`
- `metadata`

### WorkerEvidenceRecord

Fields:

- `evidence_id`
- `run_id`
- `node_run_id`
- `job_id`
- `worker_id`
- `kind`
- `summary`
- `storage_uri`
- `inline_payload`
- `redaction_status`
- `created_at`

Evidence kinds:

- `prompt`
- `model_text`
- `thinking`
- `tool_call`
- `tool_result`
- `handoff`
- `artifact_ref`
- `error`
- `usage`

### NodeHandoffRecord

Fields:

- `handoff_id`
- `run_id`
- `node_run_id`
- `job_id`
- `node_id`
- `port`
- `summary`
- `content_ref`
- `routed_node_run_ids`
- `skipped_node_run_ids`
- `created_at`

### ExecutionRef v2

Provider-neutral shape:

```ts
interface ExecutionRefV2 {
  job_id: string | null;
  worker_id: string | null;
  lease_id: string | null;
  target_kind: "local" | "external-bridge" | "docker-worker" | "node-worker" | null;
  provider_refs: Record<string, string | null>;
}
```

Compatibility:

- `openclaw_task_id` and `openclaw_session_id` move into
  `provider_refs.openclaw_task_id` and `provider_refs.openclaw_session_id`.
- Historical records may still expose legacy fields during read-time
  compatibility.

## Recovery Contract

On control-plane startup:

1. Load runs with `queued`, `running`, `waiting_human`, `paused`, or `blocked`
   status.
2. Load active jobs and leases.
3. Mark leases stale if heartbeat timeout has passed.
4. For stale local/external jobs, run adapter/harness-specific reconciliation
   only through the legacy compatibility layer.
5. For stale Docker workers, ask provisioner to inspect container state.
6. If job terminal evidence exists, apply terminal event idempotently.
7. If no terminal evidence exists and retry budget remains, requeue node.
8. If retry budget is exhausted, fail node/run with recovery audit event.

Rules:

- Recovery must not dispatch the same `job_id` twice.
- Recovery may create a new dispatch attempt with a new `job_id`.
- Every recovery decision writes an audit event.

## Secrets Contract

Rules:

- `RuntimeWorkerJob` does not contain raw model keys, OpenClaw tokens, Docker
  credentials, or workspace credentials.
- Secrets are injected at worker start or resolved inside worker runtime.
- Evidence and logs must redact:
  - authorization headers
  - API keys
  - callback tokens
  - Docker registry credentials
  - workspace secrets
- Redaction failures mark evidence as `redaction_status = "blocked"` and should
  not expose inline payload.

## Workspace Contract

Workspace modes:

- `shared`
- `isolated`
- `external`
- `unknown`

Rules:

- `shared`: worker receives a mounted repo/workspace path.
- `isolated`: provisioner creates a per-job workspace copy or volume.
- `external`: worker receives references to external systems only.
- `unknown`: allowed only for local/deterministic jobs and must be surfaced in
  runtime health.

## Resource Policy Contract

Control Plane policy owns:

- max active jobs per run
- max active workers globally
- max active workers per runtime
- timeout per job
- retry budget per node
- queue/backpressure behavior

Rules:

- RuntimeEngine applies run/node parallelism.
- NodeProvisioner applies worker capacity.
- Worker reports resource hints and current capacity during registration.

## Projection Contract

Runtime projection must include:

- run status
- node statuses
- active frontier
- active jobs
- worker/lease refs
- handoffs
- artifacts
- evidence summaries
- pending controls/human gates
- projection version

Rules:

- Studio, Mobile, polling, and live stream use the same projection shape.
- UI does not read provider-specific raw refs to determine runtime truth.
- Projection can include provider refs only as secondary diagnostic metadata.

## Cutover Rules

- HRR-1 may preserve direct `ExecutionAdapter` dispatch internally while moving
  state transitions into RuntimeEngine.
- HRR-2 makes `RuntimeWorkerJob` the dispatch mainline.
- HRR-3 introduces `services/runtime-worker` with local and OpenClaw harnesses.
- HRR-4 introduces Docker worker provisioning.
- HRR-6 removes product-level OpenClaw requirements from new records.

Any deviation from this contract should update this document first.
