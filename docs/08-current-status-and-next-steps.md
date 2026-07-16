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
- Evented Mission materialization with incremental checkpoints, event-only
  rebuild, canonical digest verification, and operator-facing status APIs.
- Credential-aware, opt-in live Provider and model-judge acceptance with
  secret-safe evidence and optional release gating.
- Workspace-scoped, multi-model Studio Provider Connections with encrypted
  managed keys or environment references, Agent Harness binding, frozen RunPlan
  snapshots, secret-safe Docker injection, and Connection-aware Doctor checks.
- HomeRail-style first-run setup with minimal model fields, automatic default
  Agent Profile binding, and Doctor-backed Git Bash/host-shell and Docker checks.

## HomeRail Alignment

The P0 and P1 HomeRail alignment program is complete for the agreed scope.

| Capability | Status | Current behavior |
| --- | --- | --- |
| Route and work-package identity | Done | Canonical route identity is retained through direct template and Session launch paths. |
| Docker Worker execution | Done | Runtime jobs can be provisioned, executed, supervised, recovered, and cleaned up through Docker Workers. |
| Operator and evaluation loop | Done | Doctor, supervise, scorecard, evaluation, replay, rerun, and trace are first-class surfaces. |
| Evidence and provider adapters | Done | Codex app-server, Claude Agent SDK, Anthropic-compatible GLM, Kimi, and OpenClaw native evidence is normalized through Evidence V2. |
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
8. Configure Provider Connections in the Studio modal, add models and choose a
   default, bind Agent Profiles, and verify the selected Connection through
   Doctor before a live acceptance lane is enabled.

## Latest Closure

The formal Product Intelligence closure (`SUP-01`, `AI-01`, and `GENUI-01`) is
complete:

- A background Proactive Supervisor scans tasks for configuration blockers,
  human gates, stalled or failed Runs, missing/failed quality evidence, and
  Autopilot handoff. Alerts are durable, fingerprint-deduplicated, resolvable,
  and visible in both Tasks and Inbox.
- Every Session can own a durable Autopilot Controller with explicit mode,
  status, phase, iteration limit, runtime limit, next tick, last action,
  handoff reason, and bounded history.
- Autopilot progresses through verified start, execution supervision, required
  human gates, retry-policy-bounded failed-node retry, deterministic Scorecard
  and Evaluation, completion, pause/resume, or explicit handback.
- The production server runs a watchdog for supervision scans and active
  Autopilot controllers; explicit scan and tick APIs remain available for
  operations and deterministic tests.
- Control Plane now generates a versioned Mission UI Plan containing only
  registered component identifiers. Studio renders it through a component
  registry, ignores unknown blocks, and always restores Task Guidance as a
  fallback.
- Generated Mission Workspace blocks cover current guidance, decisions,
  progress, results, quality, repair, conversation, and advanced technical
  detail without allowing arbitrary server-supplied HTML or code.

The third Product Intelligence stage (`PX-06`, `PX-07`, and `PX-08`) is
complete:

- Settings now expresses autonomy only as `Review first`, `Assisted`, or
  `Autopilot`; users no longer configure planner or worker parameters to state
  how much control they want.
- The selected policy persists on workspace `default-agent` metadata and is
  retained locally during first-run setup or governed Registry review.
- `Review first` leads to plan inspection. `Autopilot` may auto-advance only a
  verified, routine-ready task and still passes through strict validation,
  permission, decision, and budget boundaries.
- Provider, missing-workflow, validation, stale-plan, transition, and stopped
  Run failures map to one repair recommendation using existing product and
  runtime actions.
- Completed work gains a human result-quality surface. `Trusted` requires a
  passing pipeline Scorecard plus a passing independent Evaluation for quality
  and evidence; a successful Run by itself is never enough.
- `Check quality` records both deterministic checks through the existing Run
  APIs and reloads persisted truth before updating the label.

The second Product Intelligence stage (`PX-03`, `PX-04`, and `PX-05`) is
complete:

- A deterministic Task Guidance model compresses Session, Run, decision,
  route, transition, artifact, and output state into one human phase, no more
  than three signals, and at most one recommended action.
- `Start work` advances through the existing Session message contract, so
  strict validation, audit messages, and runtime ownership remain unchanged.
- The Tasks workspace now adapts between ready, running, paused, decision,
  result, recovery, and preparation states instead of leading with a chat and
  technical cockpit.
- Conversation, planning, runtime graph, evidence, evaluation, trace, and
  replay remain available through progressive disclosure.
- Returned deliverables lead the completed state, while decisions and failures
  are raised before passive progress.
- Business-level transition failures are re-read after every recommended
  action. A successful HTTP response cannot produce a false `Started` notice
  when the Run was not created.

The first Product Intelligence stage (`PX-00`, `PX-01`, and `PX-02`) is
complete:

- The Human Surface Contract limits the default product language to Task,
  Decision, and Result; runtime and governance concepts remain available by
  progressive disclosure.
- The default Studio shell is Tasks, Inbox, Library, and Settings. Existing
  technical routes and deep links remain available under Advanced.
- The empty Tasks surface exposes one outcome-oriented input and one primary
  `Start task` action; existing plan and DAG details are collapsed.
- Inbox loads pending approvals and human-input requests, while Library offers
  published workflows as reusable task starting points.
- Setup derives Connection internals, creates or repairs `default-agent`, binds
  the selected Connection/runtime, performs a live Connection test, and only
  advances to machine checks after verification.
- Connection state remains honest: a saved configuration is not reported as
  verified, and a failed probe persists as failed.

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

The remaining open board is now product intelligence and productization rather
than the original HomeRail alignment or runtime-semantic closure.

### Product Intelligence

The Human Surface Contract and the formal Autopilot, Generated UI, and
Proactive Supervision initiatives are complete. Long-term memory M1-M7 now
includes canonical records, governed tools, frozen Session snapshots,
historical recall, durable continuation checkpoints, hybrid lexical/semantic
retrieval, optional MemPalace integration, model-assisted full-turn extraction,
governed mutation semantics, server-side automatic recall, and unified
Conversation intent routing. The next mainline is proactive reusable
recommendations and guided onboarding while preserving the contract established
by `PX-00`.

### Mobile Productization

These items remain explicitly deferred in the authoritative tracking board:

- `MOB-01`: push notifications for approvals, human input, and Mission events.
- `MOB-02`: production login, identity provider integration, secure credential
  storage, token refresh/expiry, and account recovery. Workspace switching,
  members, roles, and audit already exist and should not be rebuilt.
- `MOB-03`: offline and degraded-network behavior for key Mission workflows.

## Recommended Execution Order

1. Continue the Product Intelligence program with task memory, proactive
   reusable recommendations, and guided onboarding.
2. Continue Mobile productization without rebuilding existing workspace
   identity and governance capabilities.
3. Extend Studio authoring only from validated operator workflows and keep it
   behind progressive disclosure.

## Verification Snapshot

Verified on 2026-07-13:

- Studio static checks after the `PX-00 -> PX-02` closure
- fresh-browser default Tasks, Inbox, Library, Settings, Advanced, and Setup
  interaction checks
- 390 x 844 responsive validation with no page-level horizontal overflow and
  one visible new-task entry
- fresh-browser console validation with no errors
- six deterministic Task Guidance state and directive tests
- real local `Start work` interaction against a no-template environment,
  verifying that the backend refusal becomes `Needs attention` and never a
  false success notice
- seven focused Autonomy, Repair Guidance, and Result Quality projection tests
- three additional Task Guidance composition tests for Review first, missing
  quality evidence, and repair priority
- browser persistence of `Review first -> Assisted` on workspace
  `default-agent.metadata.product_autonomy_mode`
- browser repair routing from a blocked task to simplified Settings
- focused Control Plane integration for durable alert deduplication, strict
  Autopilot Run creation, and whitelist-only Mission UI Plan generation
- full API Gateway suite with explicit Supervision and Autopilot route coverage
- generated OpenAPI/shared-type drift checks for alerts, controllers, and UI
  plans
- `npm run check`
- focused Control Plane Mission materializer module and HTTP integration tests
- API Gateway, CLI, Runtime Worker, Mobile, shared-types, and execution-adapter
  package tests
- representative full Session create, plan, and linked-Run API integration
- credential-free `npm run live:acceptance` safety run (`skipped`, no model call)
- real Codex app-server workspace/tool/usage acceptance (passed)
- real GLM 5.2 Agent SDK host and Docker workspace/tool/usage acceptance
  (passed with verified TLS)
- Runtime Worker image build, Codex binary, and app-server JSON-RPC handshake
- credential-free Docker Agent Harness behavior (`unavailable`, not recorded as passed)
- LIVE-01 result validation against its JSON Schema
- actionlint `1.7.12` over `.github/workflows`

The root `npm test` aggregate was also attempted, but the Control Plane
aggregate did not finish within a six-minute process limit. Its MW-04 tests and
representative compatibility flows pass independently; the aggregate timeout
is not recorded as a successful full-suite run.

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
- `docs/34-rt-05-rt-06-stu-04-runtime-and-authoring-closure.md`
- `docs/35-mw-04-live-01-materializer-and-live-acceptance-closure.md`
- `docs/36-product-intelligence-human-surface-contract.md`
# M6 completion update (2026-07-16)

Long-term memory M1-M6 is now implemented end to end. M6 adds the Memory Center and Inbox review surface, background extraction, Project snapshot extension, lifecycle/retention maintenance, JSON/JSONL import/export, Provider Connection-backed embeddings, observability, Gateway/OpenAPI contracts, and responsive browser acceptance. See `docs/57-memory-center-lifecycle-and-background-review.md`.

# M7 completion update (2026-07-16)

M7 adds a configurable Memory Intelligence model, model-assisted full-turn extraction, governed create/update/supersede/delete/ignore semantics, server-side scoped automatic recall, one structured Conversation Intent Router, built-in quality metrics, complete settings/observability contracts, and Studio controls. See `docs/58-memory-intelligence-and-intent-routing.md`.

# M8 completion update (2026-07-16)

M8 adds AES-256-GCM Private Memory encryption and migration, normal-only knowledge projection cleanup, generation-aware recall caching, independent multi-Workspace maintenance, explainable current-Task recommendations, privacy-safe proactive alerts, expanded intent and Memory-operation quality gates, and complete Studio/API/OpenAPI observability. See `docs/59-memory-production-hardening-and-proactive-reuse.md`.
