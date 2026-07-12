# My Mate Current Status And Next Steps

Last synchronized: 2026-07-12.

This document is the concise entry point for the current repository state. The
authoritative task board and acceptance evidence live in
`docs/19-progress-tracking-checklist.md`. Historical implementation blueprints
remain useful for design context, but their unchecked boxes are not current
status unless they are also present on the `docs/19` open tracking board.

## Current Baseline

My Mate now has a complete local orchestration loop rather than a design-only
or demo-only skeleton.

The shipped baseline includes:

- Mission-first Mobile and Studio workspaces with Session as the conversation
  and audit rail.
- Planner-backed route selection, editable DAG drafts, revision comparison,
  confirmation, publishing, and strict-by-default Run creation.
- Runtime steering for pause, skip, add node, parallelism changes, and resume
  with persisted patch review and topology history.
- A HomeRail-like Manager -> Dispatcher -> Provisioner -> Runtime Worker ->
  Harness execution path, including real Docker Worker smoke coverage.
- The operator loop `doctor -> run -> supervise -> scorecard -> eval -> replay
  -> trace` through the CLI and Control Plane APIs.
- Evidence Protocol V2, provider-native evidence normalization, usage and cost
  projection, evaluation, trace, pure replay, and linked rerun.
- Deterministic shared DAG layout for authoring, comparison, runtime graph, and
  Mobile topology inspection.
- SQLite-backed production storage behind the shared storage seam.
- Multi-workspace identity, request-scoped tenant isolation, persistent RBAC,
  hash-chained audit, and registry governance proposals.
- Unified runtime observability, indexed metrics, failure aggregation, cost
  attribution, timeout compensation, cleanup-gated retry, and failure replay.
- OpenAPI-generated shared types and typed Control Plane client behavior.

## HomeRail Alignment

The P0 and P1 HomeRail alignment program is complete for the agreed scope.

| Capability | Status | Current behavior |
| --- | --- | --- |
| Route and work-package identity | Done | Canonical route identity is retained through direct template and Session launch paths. |
| Docker Worker execution | Done | Runtime jobs can be provisioned, executed, supervised, recovered, and cleaned up through Docker Workers. |
| Operator and evaluation loop | Done | Doctor, supervise, scorecard, evaluation, replay, rerun, and trace are first-class surfaces. |
| Evidence and provider adapters | Done | Codex, Claude SDK, Kimi, and OpenClaw recorded native evidence is normalized through Evidence V2. |
| Runtime graph UX | Done | Studio uses the spatial DAG as the primary Run view with deterministic Mobile fallback. |
| Recovery and operations | Done | Capacity, queueing, timeout compensation, cleanup gating, restart continuation, and failure replay are persisted and observable. |

Live provider calls, model-judge evaluation, and real OpenClaw environments are
explicit opt-in checks. Their absence from the default deterministic test suite
does not imply that offline provider normalization is missing.

## Runnable Today

The repository supports these end-to-end flows:

1. Create or select a workspace and operate under request-scoped identity.
2. Create a Mission, clarify the brief, draft or compare routes, and confirm a
   route revision.
3. Create a strict-validated Run from a confirmed route or published template.
4. Execute locally or through provisioned Docker Runtime Workers.
5. Inspect graph progress, work packages, human gates, evidence, artifacts,
   usage, cost, trace, evaluation, and scorecard state.
6. Pause, revise, skip, add work, change parallelism, resume, cancel, recover,
   replay projections, or launch a frozen-identity failure replay.
7. Govern protected Registry changes through proposal, independent review,
   drift-safe apply, and audit evidence.

## Latest Closure

`RT-04` structured edge conditions and failure recovery are complete:

- A bounded declarative AST evaluates lifecycle conditions, structured
  predicates, and `all`/`any`/`not` composition without script execution.
- Port and condition matching persist per-edge routing decisions for Trace,
  Replay, Runtime Graph, and scorecard evidence.
- Retry remains higher priority than recovery; a matched failure route keeps
  the Run active while preserving the source node as failed.
- A Run may complete with recovered failed nodes, while unmatched failure
  handoffs still terminate the Run.
- Runtime Graph distinguishes recovered failures and evaluated untaken edges.

Production Release Engineering (`REL-01`, `REL-02`, and `REL-03`) remains
complete:

- Runtime Worker defaults use the repository semantic version instead of
  `latest`, while explicit local and digest overrides remain supported.
- OCI labels, Worker health/registration metadata, and Doctor expose image and
  build provenance.
- PR/main CI and tag/manual release gates cover generated drift, checks, tests,
  image verification, Docker operator smoke, and restart recovery.
- The stock Worker uses `node:22-alpine`; pinned Syft/Grype produce CycloneDX
  and SARIF evidence and block Critical vulnerabilities.
- Version tags publish a provenance/SBOM-attested GHCR digest and sign it with
  GitHub OIDC/cosign; upgrade and rollback operate on digests.

## Remaining Work

The remaining work is productization and deeper runtime semantics. It is not a
continuation of the original P0/P1 HomeRail closure.

### 1. Deeper Runtime Semantics

- Add Worker-native human-gate suspend/resume instead of relying primarily on
  Manager-side approval followed by node requeue.
- Support dynamic fanout cardinality derived during execution.
- Complete harness-specific pause/resume/cancel guarantees and
  control-during-provisioning coverage.

### 2. Full Studio DAG Editing

- Add direct node dragging with persisted coordinates or deterministic
  constraint reconciliation.
- Add canvas edge creation, reconnection, deletion, port selection, and
  condition editing.
- Add interactive topology validation, undo/redo, keyboard editing, and graph
  patch preview before save or publish.
- Keep the current form-backed editor as an accessible deterministic fallback.

### 3. Evented Mission Materialization

- Replace read-time-only Mission/Session projection with an independently
  rebuildable evented materializer.
- Add materializer checkpoints, versioning, replay, rebuild, lag reporting, and
  consistency verification against canonical Session/Run/Event stores.
- Preserve the current Mission Workspace contract so Mobile and Studio do not
  depend on storage implementation details.

### 4. Live Provider Release Acceptance

- Add credential-aware, explicitly enabled live acceptance jobs for Codex,
  Claude, Kimi, and OpenClaw.
- Add a real model-judge acceptance lane without making nondeterministic model
  output a blocking default unit-test dependency.
- Store provider/version/environment evidence with release results.

### 5. Mobile Productization

These items remain explicitly deferred in the authoritative tracking board:

- `MOB-01`: push notifications for approvals, human input, and Mission events.
- `MOB-02`: production login, identity provider integration, secure credential
  storage, token refresh/expiry, and account recovery. Workspace switching,
  members, roles, and audit already exist and should not be rebuilt.
- `MOB-03`: offline and degraded-network behavior for key Mission workflows.

## Recommended Execution Order

1. Implement `RT-05` Worker-native human-gate suspend/resume.
2. Implement `RT-06` dynamic fanout and remaining control guarantees.
3. Build the full Studio DAG editor or the Mobile productization track based on
   the next product priority; do not start both as one delivery slice.
4. Introduce the evented Mission materializer after its event/version contract
   is fixed.

## Verification Snapshot

Verified on 2026-07-12:

- `npm run check`
- `npm test`
- `npm run runtime-worker:image`
- `npm run runtime-worker:verify-image`
- `npm run runtime-worker:sbom`
- `npm run runtime-worker:scan`
- `npm run runtime-worker:smoke`
- `npm run runtime-worker:recovery-smoke`
- actionlint over `.github/workflows`

The default Runtime Worker live-provider test remains skipped unless its
explicit opt-in environment is configured.

## Related Documents

- `docs/19-progress-tracking-checklist.md`
- `docs/22-homerail-like-runtime-architecture.md`
- `docs/23-homerail-like-runtime-rewrite-checklist.md`
- `docs/24-homerail-like-runtime-contract-v1.md`
- `docs/27-p0-p1-implementation-blueprint.md`
- `docs/29-data-03-registry-governance.md`
- `docs/30-obs-02-cost-attribution.md`
- `docs/31-oc-02-timeout-compensation-failure-replay.md`
- `docs/32-runtime-worker-release-engineering.md`
- `docs/33-rt-04-structured-edge-conditions-and-failure-recovery.md`
