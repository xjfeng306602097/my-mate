# Risk-Routed Runtime and Sandbox Change Sets

Status: core safety and Studio review loop implemented

## Runtime placement

Runtime Jobs now carry an explicit execution policy with risk level, workspace
access mode, approval requirement, requested target, resolved target, and human
readable reasons.

- Local deterministic work without a live project path can use the in-process
  Runtime Worker and consume bounded context snapshots.
- Codex, Claude SDK, GLM, Kimi, and other real Agent Harnesses default to Docker.
- A task with `project_local_repo` plus write, patch, shell, terminal, Git, move,
  rename, or delete tools is high risk and forced to Docker even when node config
  requests `local`.
- Any other task carrying `project_local_repo` is still staged into Docker as
  elevated risk; the raw live path is never handed to Local execution.
- OpenClaw remains behind its external bridge until that runtime has an equivalent
  sandbox contract.

## Docker workspace boundary

`project_local_repo` is no longer bind-mounted into a Runtime Worker. Trusted
Desktop-bound Runs use one Run-scoped copy under
`runtime-workspaces/<run>/project` and mount only that copy. Workspace-bound Runs
use one dispatch lane so later nodes see earlier Worker edits without concurrent
writers.

The copy excludes dependency/build caches, VCS metadata, Control Plane runtime
data, common credential files, private keys, `.env` secrets, and symbolic links.
File count, per-file byte, and total byte limits prevent unbounded staging.

## Change review and application

At Run termination, the sandbox is compared with its baseline. A persisted
Change Set records added, modified, and deleted paths with before/after SHA-256,
sizes, and file mode. It starts in `pending`; there is no automatic write-back.

API surface:

- `GET /api/runtime/workspace-change-sets`
- `GET /api/runtime/workspace-change-sets/:changeSetId`
- `POST /api/runtime/workspace-change-sets/:changeSetId/apply`
- `POST /api/runtime/workspace-change-sets/:changeSetId/reject`

Application validates every source file against the dispatch baseline before
writing anything. A user edit made while the Worker was running returns a
workspace conflict instead of being overwritten. The sandbox result is also
rehashed so a reviewed Change Set cannot be applied after its staged files change.
Symbolic links block the Change Set.

## Studio review surface

Studio Inbox now treats open Change Sets as operator attention items and provides:

- a Change Set list, changed-file list, and line-level diff pane;
- added, modified, and deleted file summaries with old/new line numbers;
- bounded context with explicit trimming state;
- metadata-only binary and oversized-file previews with full sizes and SHA-256;
- blocked and apply-failed states that can be rejected but not applied;
- two-step Apply and Reject confirmation;
- desktop, compact, and mobile layouts without document-level horizontal overflow.

Reject remains available through API Gateway. Desktop-bound Apply requires an
Electron bridge credential and native confirmation; the public Web API cannot
write those source folders. Apply revalidates reviewed source and sandbox hashes,
stages backups, and rolls earlier files back if a later write fails. The Change
Set records resolver, time, and comment.

## Coverage against the agreed strategy

The current implementation covers the agreed core workflow:

1. Desktop Host mediates bounded reads from a user-selected local folder.
2. Explicit file snapshots can travel to Runtime Workers without exposing the
   original local path.
3. Low-risk deterministic work may stay local; real Agent Harnesses and any
   project-local access are routed to Docker.
4. Docker receives a filtered Run-scoped copy rather than the source workspace.
5. Run Workspace mutations become approval-gated Change Sets and never write back
   automatically.
6. Studio provides visual review and explicit Apply or Reject decisions.

## Three-mode smoke verification

The repository has repeatable operational smoke coverage for every runtime
placement. Run all three sequentially with:

```powershell
npm run runtime-modes:smoke
```

Each mode can also be isolated when diagnosing a failure:

| Mode | Command | Concrete operation | Required proof |
| --- | --- | --- | --- |
| `local` | `npm run runtime-worker:local-smoke` | Create a low-risk deterministic task through API Gateway. | Run and Job complete with `target_kind=local`, one artifact is returned, and no Docker Worker or lease is created. Local does not emit Worker Hub evidence because it executes through the in-process client. |
| `docker-worker` | `npm run runtime-worker:smoke` | Execute a two-node draft/review workflow in disposable Runtime Worker containers. | Both Jobs, handoffs, and artifacts complete; Worker evidence, trace, scorecard, evaluation, and replay are present; containers, workers, and leases are released. |
| `external-bridge` | `node scripts/openclaw-isolated-e2e.mjs` | Dispatch a real backend task through the Execution Adapter into the `openclaw-local` container using `container-exec` and `direct-agent`. | The OpenClaw task succeeds, accepted/completed callbacks reach the Control Plane, task/session/trajectory references are retained, and agent-report plus handoff artifacts are persisted. |

The OpenClaw smoke defaults to a six-minute terminal-state window because model
execution time varies. Override it with `MY_MATE_OPENCLAW_E2E_TIMEOUT_MS` when a
slower environment needs a larger bound.

Observed on 2026-07-13:

- Local: one completed Local Job, one artifact, zero connected Workers, zero
  active leases.
- Docker Worker: two completed Jobs, two handoffs, two artifacts, ten evidence
  records, replay verification `pass`, and zero residual runtime resources.
- External bridge: completed My Mate Run and dispatch, succeeded OpenClaw task,
  sixteen lifecycle events, two artifacts, and both accepted and completed
  callbacks observed.

## Remaining hardening

The following items are not part of the completed core loop and must remain
visible as production hardening:

- add Change Set-specific audit metadata in addition to the generic authenticated
  request audit event;
- support capability revocation and expiry;
- use Git worktree staging for repositories where bounded copying is too costly;
- keep Git mutation and terminal/PTY capabilities behind separate policies and
  approvals.
