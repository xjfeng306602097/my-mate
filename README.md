# My Mate

`My Mate` is a mobile-first agent control platform with one provider-neutral
Native Agent Runtime. Provider harnesses run through local, Docker, or isolated
workers without introducing a second Agent Runtime.

This repository currently focuses on:

- conversation-first mission planning and runtime intervention
- a persistent DAG control plane with approvals, human input, retries, and recovery
- a shared Manager/Worker protocol with sequenced, idempotent events
- Docker worker provisioning, leases, heartbeats, evidence, handoffs, and cleanup
- Studio and Mobile runtime inspection surfaces
- versioned Agent definitions, immutable bindings, and durable AgentDag execution

## Repository Goals

This project should evolve into:

- a mobile app for task initiation and intervention
- a PC workflow studio for DAG/template authoring
- a workflow control plane
- provider-neutral local, Docker, and remote worker execution
- storage-boundary migration for historical Profile, Workflow, and Run records

## Repository Structure

```text
docs/                   # architecture, roadmap, product design
openapi/                # API contract drafts
schemas/                # JSON Schema source of truth
apps/
  cli/                  # Gateway-only operator CLI
  mobile/               # Expo mobile shell (home / inbox / follow-up)
  studio/               # PC workflow studio for template/DAG authoring
services/
  api-gateway/          # client-facing BFF/API proxy
  control-plane/        # workflow engine and scheduler
  runtime-worker/       # Docker/local worker daemon and harness clients
packages/
  shared-types/         # shared runtime protocol and DTO source of truth
```

## Current Design Documents

- [Current status and next steps](docs/08-current-status-and-next-steps.md)
- [Progress and acceptance tracking](docs/19-progress-tracking-checklist.md)
- [Mission workspace contract](docs/20-mission-workspace-contract.md)
- [Agent and scheduled task V2](docs/68-agent-and-cron-v2.md)
- [Unified orchestration protocol](docs/69-unified-orchestration-protocol.md)
- [Long-task runtime](docs/70-long-task-runtime-and-business-flow.md)
- [DAG and long-task closeout](docs/71-dag-long-task-closeout.md)
- [Native Agent Runtime](docs/72-native-agent-runtime.md)

Earlier numbered documents are historical design records. They are not current
runtime contracts and may describe retired prototypes.

## Tenancy And Identity

Production-style workspace identity is resolved at API Gateway and forwarded to
Control Plane as an HMAC-signed context. Configure the same internal secret on
both services:

- `MY_MATE_INTERNAL_AUTH_SECRET`
- `MY_MATE_API_GATEWAY_IDENTITIES_JSON` on API Gateway

Clients send a bearer token and may select one of their memberships with
`X-My-Mate-Workspace-Id`. Control Plane reconciles that signed membership with
persistent RBAC state, isolates workspace records, and records protected
outcomes in a per-workspace audit hash chain. See the DATA-02 document for the
identity JSON shape, role matrix, migration behavior, and client configuration.

## Registry Governance

Every workspace starts with advisory Registry governance. Owner/admin users can
enable enforced mode to require a proposal, independent review, and separate
apply action for Agent, Skill, and Template publish/archive mutations:

```bash
npm run my-mate -- governance policy --mode enforced --required-approvals 1 --self-approval deny
npm run my-mate -- governance list --status pending
```

Enforced direct writes return `409 governance_approval_required`. Proposals
freeze the reviewed payload and resource baseline digests; apply returns a
`conflicted` change instead of overwriting concurrent state. See the DATA-03
document for the protocol, permissions, API, Studio workflow, and rollout plan.

## Docker Runtime

Build and smoke-test the default deterministic worker image:

```bash
npm run runtime-worker:image
npm run runtime-worker:verify-image
npm run runtime-worker:sbom
npm run runtime-worker:scan
npm run runtime-worker:smoke
```

The default image is versioned from `services/runtime-worker/package.json`
(`my-mate-runtime-worker:0.1.0` for the current repository). The build command
rejects `latest`, untagged, and custom mutable tags unless
`MY_MATE_ALLOW_MUTABLE_WORKER_IMAGE=true` is set for an explicit local-only
build. A registry digest is also accepted.

The image records OCI version, Git revision, build time, and source labels. The
same provenance is exposed by the Worker `/health` endpoint and Worker Manager
registration metadata.

Run the Control Plane with Docker workers:

```bash
npm run dev:docker-runtime
```

Important runtime settings:

- `MY_MATE_RUNTIME_WORKER_IMAGE`: explicit Worker image tag or digest.
- `MY_MATE_RUNTIME_WORKER_IMAGE_REPOSITORY`: repository used with the project
  version when an explicit image is not provided.
- `MY_MATE_RUNTIME_WORKER_RELEASE_VERSION`: packaged Control Plane fallback
  when the Runtime Worker package manifest is not present.
- `MY_MATE_ALLOW_MUTABLE_WORKER_IMAGE`: permits a non-release image reference
  only for an explicit local build.
- `MY_MATE_BUILD_REVISION`, `MY_MATE_BUILD_DATE`, `MY_MATE_BUILD_SOURCE`:
  optional reproducible provenance overrides for image builds.
- `MY_MATE_RUNTIME_WORKER_BUILD_BEFORE_SMOKE`: explicitly rebuild before a
  standalone smoke; by default smoke commands consume the already verified
  image and do not perform hidden network builds.
- `MY_MATE_RUNTIME_WORKER_MANAGER_WS_URL`: externally reachable Manager URL when auto-detection is not sufficient.
- `MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV`: comma-separated host env names passed to Worker containers without embedding values in Docker arguments.
- `MY_MATE_CODEX_COMMAND`, `MY_MATE_CLAUDE_SDK_COMMAND`, `MY_MATE_KIMI_COMMAND`: command harness entry points available inside the selected Worker image.
- `MY_MATE_WORKER_CAPABILITIES`: capabilities advertised by a custom Worker image.

The stock image always supports the deterministic `local` harness. Codex,
Claude SDK, and Kimi require a Worker image that contains the corresponding
command and configures its command environment variable.

Pull requests and `main` pushes run `.github/workflows/ci.yml`. Version tags and
manual release validation run `.github/workflows/runtime-worker-release.yml`,
which checks tag/package alignment, builds and verifies the versioned image,
generates SBOM/vulnerability evidence, then runs the deterministic operator and
restart-recovery Docker smokes. Version tags publish a provenance-attested GHCR
digest and sign it with GitHub OIDC/cosign. Upgrade and rollback policy is in
`docs/32-runtime-worker-release-engineering.md`.

## P0 Operator Loop

The P0 runtime path can be operated through API Gateway without reading or
mutating Control Plane storage directly:

```bash
npm run my-mate -- doctor --mode docker
npm run my-mate -- run --template-id <template-id> --intent "Verify the workflow" --follow --scorecard
npm run my-mate -- supervise <run-id> --follow
npm run my-mate -- scorecard <run-id>
npm run my-mate -- eval <run-id> --evaluator none
```

The completed P0 foundation includes:

- persisted canonical route identity and compiled work-package identity
- initialization-safe run bundles with initial and effective plans
- ordered, idempotent lifecycle events and frozen evidence snapshots
- Docker Worker jobs, registration, leases, handoffs, evidence, and cleanup
- quick, Docker, and model Doctor reports with separate deterministic and
  model readiness
- cursor-based supervision and a persisted 14-check `pipeline-v1` scorecard

`doctor --mode docker` proves deterministic Docker readiness. Model readiness
is reported independently; `--model-probe` is opt-in and may call a configured
provider. Deterministic readiness does not by itself prove provider-native
tools, usage, cost, or semantic quality; those remain separately reported.

See `apps/cli/README.md` for configuration, output modes, and exit codes.

## P1 Evaluation And Evidence Progress

P1-C1, P1-C2, P1-D1, and P1-D2 are implemented. Evidence V2 supports sequence, source, trace,
input/output references, usage availability, redaction status, and V1
compatibility. Provider harnesses normalize Codex JSONL/app-server, Claude
Agent SDK, Kimi stream/ACP/SDK, and OpenAI-compatible events into complete model
turn, text/thinking, tool call/result, usage, and provider-error evidence.

Unrecognized command or bridge output still uses the D1 synthetic fallback and
reports usage as unavailable. The Control Plane estimates cost only for an
exact provider/model match in a versioned catalog; unknown pricing remains
`null`, and provider-reported cost is retained separately. Recorded fixtures
are the default verification path. Live provider verification is explicitly
opt-in and is not implied by deterministic Docker readiness.

C1 adds JSON-Schema-validated declarative contract checks, independent
pipeline/contract/evidence/usage/quality verdicts, persisted evaluation APIs,
and the `my-mate eval` CLI command. `none` reports quality as
`not_evaluated`; `deterministic-v1` evaluates only policy assertions explicitly
marked for quality; `model-v1` runs an opt-in Anthropic judge in a separate
recoverable queue. Judge errors become `quality=error`, never task-quality
failure.

C2 adds a first-class run/node/job/model/tool/handoff/artifact/control trace
projection, a pure audit replay reducer, persisted projection differences,
categorized replay plans, and linked reruns from the frozen effective plan.
Complete V2 runs can verify `replay=pass`; legacy runs return `partial` rather
than claiming exact reconstruction. Rerun retries are protected by
`Idempotency-Key`. Graph-first Studio and evaluation UI remain E1/E2.

OC-02 adds persistent Job/node/Lease deadline compensation, cleanup-gated
capacity restoration, restart continuation, and failed-node execution Replay
from the frozen source Job identity. Recovery evidence is visible through
Trace, Runtime projection, CLI, and the Studio Runtime Graph Recovery tab.

## Mobile App Shell

`apps/mobile` now contains an Expo / React Native shell that connects to:

- `GET /api/mobile/home`
- `GET /api/mobile/inbox`
- `GET /api/mobile/runs/:runId/follow-up`
- approval / human-input / pause / resume / cancel actions

Run it with:

```bash
cd apps/mobile
npm install
npm run dev
```

Set the API base URL with:

`EXPO_PUBLIC_MY_MATE_API_BASE_URL=http://127.0.0.1:4030`

## API Gateway

`services/api-gateway` exposes the client-facing entry point for mobile and future Studio clients.

Run it with:

```bash
cd services/api-gateway
npm install
npm run dev
```

By default it proxies allowlisted requests to:

`MY_MATE_CONTROL_PLANE_BASE_URL=http://127.0.0.1:4010`

Client-facing planner endpoints are exposed through the gateway:

- `POST /api/planner/template-selection`
- `POST /api/planner/candidate-plan`

The planner is a pluggable `PlannerProvider` registry. Three providers ship in-tree:

- `rule_based_v1` — deterministic token overlap + registry readiness ranking; always the fallback.
- `local_semantic_v1` — adds a coding/research/content/ops/customer/review domain dictionary on top of `rule_based_v1`, reranks by domain match, supports EN + ZH cues.
- `llm_claude_v1` — calls the Anthropic API with `select_template` tool-use. Requires `ANTHROPIC_API_KEY`; only handles `recommendTemplate` (DAG draft and candidate-plan compilation continue through `rule_based_v1`).

Active provider is selected via `MY_MATE_PLANNER_PROVIDER` (defaults to `rule_based_v1`). Non-template provider errors transparently fall back to `rule_based_v1`; every response carries `planner_context.provider_id`, `fallback_used`, and (when applicable) `fallback_reason`. Candidate previews surface structured agent/skill/input warnings before a real run is created.

Real `POST /api/runs` creation now defaults to `validation_mode: "strict"` when the field is omitted. Invalid requests are blocked with `run_validation_failed`, and clients must explicitly retry with `validation_mode: "warn"` after human confirmation if they want to continue with warnings.

## Workflow Studio

`apps/studio` provides a local PC workflow authoring surface.

Run it with:

```bash
cd apps/studio
npm run dev
```

Default URL:

`http://127.0.0.1:5174`
