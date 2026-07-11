# My Mate

`My Mate` is a mobile-first agent control platform with its own provider-neutral
workflow runtime. OpenClaw remains supported as a compatibility harness, while
new execution can run through provisioned Docker workers.

This repository currently focuses on:

- conversation-first mission planning and runtime intervention
- a persistent DAG control plane with approvals, human input, retries, and recovery
- a shared Manager/Worker protocol with sequenced, idempotent events
- Docker worker provisioning, leases, heartbeats, evidence, handoffs, and cleanup
- Studio and Mobile runtime inspection surfaces
- compatibility execution through the existing OpenClaw bridge

## Repository Goals

This project should evolve into:

- a mobile app for task initiation and intervention
- a PC workflow studio for DAG/template authoring
- a workflow control plane
- provider-neutral local, Docker, and remote worker execution
- an OpenClaw bridge kept behind the harness/legacy adapter boundary

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
  execution-adapter/    # OpenClaw bridge service
  runtime-worker/       # Docker/local worker daemon and harness clients
packages/
  shared-types/         # shared runtime protocol and DTO source of truth
```

## Current Design Documents

- [docs/01-my-mate-overall-architecture.md](/C:/project/my-mate/docs/01-my-mate-overall-architecture.md)
- [docs/02-my-mate-implementation-roadmap.md](/C:/project/my-mate/docs/02-my-mate-implementation-roadmap.md)
- [docs/03-my-mate-schema-and-api-draft.md](/C:/project/my-mate/docs/03-my-mate-schema-and-api-draft.md)
- [docs/04-my-mate-repository-structure.md](/C:/project/my-mate/docs/04-my-mate-repository-structure.md)
- [docs/05-my-mate-interaction-architecture.md](/C:/project/my-mate/docs/05-my-mate-interaction-architecture.md)
- [docs/06-my-mate-openclaw-integration-plan.md](/C:/project/my-mate/docs/06-my-mate-openclaw-integration-plan.md)
- [docs/07-visual-acceptance-guide.md](/C:/project/my-mate/docs/07-visual-acceptance-guide.md)
- [docs/08-current-status-and-next-steps.md](/C:/project/my-mate/docs/08-current-status-and-next-steps.md)
- [docs/09-conversation-first-orchestrator-redesign.md](/C:/project/my-mate/docs/09-conversation-first-orchestrator-redesign.md)
- [docs/10-bilibili-reference-video-review.md](/C:/project/my-mate/docs/10-bilibili-reference-video-review.md)
- [docs/11-openclaw-conversation-product-implementation.md](/C:/project/my-mate/docs/11-openclaw-conversation-product-implementation.md)
- [docs/12-phased-implementation-plan.md](/C:/project/my-mate/docs/12-phased-implementation-plan.md)
- [docs/13-dual-video-product-alignment.md](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)
- [docs/14-hermes-desktop-gap-analysis-and-next-iteration-plan.md](/C:/project/my-mate/docs/14-hermes-desktop-gap-analysis-and-next-iteration-plan.md)
- [docs/15-studio-v2-orchestrator-workbench.md](/C:/project/my-mate/docs/15-studio-v2-orchestrator-workbench.md)
- [docs/16-dag-proposal-domain-and-api-draft.md](/C:/project/my-mate/docs/16-dag-proposal-domain-and-api-draft.md)
- [docs/17-dag-proposal-code-change-plan.md](/C:/project/my-mate/docs/17-dag-proposal-code-change-plan.md)
- [docs/18-openclaw-end-to-end-flow.md](/C:/project/my-mate/docs/18-openclaw-end-to-end-flow.md)
- [docs/19-progress-tracking-checklist.md](/C:/project/my-mate/docs/19-progress-tracking-checklist.md)
- [docs/20-mission-workspace-contract.md](/C:/project/my-mate/docs/20-mission-workspace-contract.md)
- [docs/21-my-mate-vs-homerail-positioning.md](/C:/project/my-mate/docs/21-my-mate-vs-homerail-positioning.md)
- [docs/22-homerail-like-runtime-architecture.md](/C:/project/my-mate/docs/22-homerail-like-runtime-architecture.md)
- [docs/23-homerail-like-runtime-rewrite-checklist.md](/C:/project/my-mate/docs/23-homerail-like-runtime-rewrite-checklist.md)
- [docs/24-homerail-like-runtime-contract-v1.md](/C:/project/my-mate/docs/24-homerail-like-runtime-contract-v1.md)
- [docs/25-homerail-human-flow-comparison.md](/C:/project/my-mate/docs/25-homerail-human-flow-comparison.md)
- [docs/26-homerail-gap-closure-plan.md](/C:/project/my-mate/docs/26-homerail-gap-closure-plan.md)
- [docs/27-p0-p1-implementation-blueprint.md](/C:/project/my-mate/docs/27-p0-p1-implementation-blueprint.md)
- [docs/28-data-02-tenancy-governance.md](/C:/project/my-mate/docs/28-data-02-tenancy-governance.md)

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

## Docker Runtime

Build and smoke-test the default deterministic worker image:

```bash
npm run runtime-worker:image
npm run runtime-worker:smoke
```

Run the Control Plane with Docker workers:

```bash
npm run dev:docker-runtime
```

Important runtime settings:

- `MY_MATE_RUNTIME_WORKER_IMAGE`: default Worker image.
- `MY_MATE_RUNTIME_WORKER_MANAGER_WS_URL`: externally reachable Manager URL when auto-detection is not sufficient.
- `MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV`: comma-separated host env names passed to Worker containers without embedding values in Docker arguments.
- `MY_MATE_CODEX_COMMAND`, `MY_MATE_CLAUDE_SDK_COMMAND`, `MY_MATE_KIMI_COMMAND`: command harness entry points available inside the selected Worker image.
- `MY_MATE_WORKER_CAPABILITIES`: capabilities advertised by a custom Worker image.

The stock image always supports the deterministic `local` harness. Codex,
Claude SDK, and Kimi require a Worker image that contains the corresponding
command and configures its command environment variable.

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
compatibility. Stateful adapters now normalize Codex JSONL/app-server, Claude
Agent SDK, Kimi stream/ACP/SDK, and OpenClaw bridge events into complete model
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
