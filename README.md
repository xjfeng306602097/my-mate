# My Mate

`My Mate` is a mobile-first agent control platform built above an existing agent execution kernel such as OpenClaw.

This repository currently focuses on:

- product and system design
- formal schemas
- API contracts
- recommended project structure
- control-plane, api-gateway, and execution-adapter MVPs
- mobile app shell for the phone control experience
- workflow studio MVP for template/DAG authoring

It does not yet contain the full runtime implementation.

## Repository Goals

This project should evolve into:

- a mobile app for task initiation and intervention
- a PC workflow studio for DAG/template authoring
- a workflow control plane
- an execution adapter to OpenClaw
- an OpenClaw bridge service for Dockerized runtime integration

## Repository Structure

```text
docs/                   # architecture, roadmap, product design
openapi/                # API contract drafts
schemas/                # JSON Schema source of truth
apps/
  mobile/               # Expo mobile shell (home / inbox / follow-up)
  studio/               # PC workflow studio for template/DAG authoring
services/
  api-gateway/          # client-facing BFF/API proxy
  control-plane/        # workflow engine and scheduler
  execution-adapter/    # OpenClaw bridge service
packages/
  shared-types/         # generated/shared DTOs (future)
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
