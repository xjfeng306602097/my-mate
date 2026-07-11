# My Mate vs HomeRail Positioning

Status: superseded by `docs/22-homerail-like-runtime-architecture.md`.

The current product direction is to make My Mate more HomeRail-like at the
runtime architecture level while keeping My Mate's mission workspace product
surface. The older recommendation in this document to avoid runtime-first
comparison should be read as historical analysis, not the current direction.

This document is a positioning comparison, not a feature-by-feature benchmark.

Its purpose is to answer one practical question:

how should `My Mate` describe itself now that `HomeRail` exists as a strong
public point of comparison?

## Reference Snapshot

This comparison was reviewed on `2026-07-09`.

Public HomeRail references reviewed:

- GitHub repository:
  - <https://github.com/xiaotianfotos/homerail>
- README:
  - <https://raw.githubusercontent.com/xiaotianfotos/homerail/main/README.md>
- Roadmap:
  - <https://raw.githubusercontent.com/xiaotianfotos/homerail/main/ROADMAP.md>
- GitHub API repository metadata:
  - <https://api.github.com/repos/xiaotianfotos/homerail>

Current My Mate references reviewed:

- [`README.md`](/C:/project/my-mate/README.md)
- [`docs/08-current-status-and-next-steps.md`](/C:/project/my-mate/docs/08-current-status-and-next-steps.md)
- [`docs/13-dual-video-product-alignment.md`](/C:/project/my-mate/docs/13-dual-video-product-alignment.md)
- [`docs/20-mission-workspace-contract.md`](/C:/project/my-mate/docs/20-mission-workspace-contract.md)
- [`apps/mobile/README.md`](/C:/project/my-mate/apps/mobile/README.md)
- [`apps/studio/README.md`](/C:/project/my-mate/apps/studio/README.md)

Repository metadata snapshot taken on `2026-07-09`:

- `HomeRail`
  - created: `2026-07-07`
  - updated: `2026-07-09`
  - stars: `332`
  - forks: `69`
  - public description:
    `Voice-first local agent orchestration runtime for auditable DAG workflows.`

## Executive Summary

`My Mate` and `HomeRail` overlap in orchestration, auditability, and long-running
agent work.

They should not, however, be described as the same product.

The cleanest reading is:

- `HomeRail` is a runtime-first local orchestration system
- `My Mate` should be described as a mission workspace and intervention layer
  above an execution runtime

If `My Mate` keeps presenting itself as another general orchestration runtime or
another DAG platform, it will invite a comparison on `HomeRail`'s strongest
ground.

If `My Mate` instead presents itself as the product layer for shaping,
supervising, intervening in, and closing long-running agent work, then the two
projects become adjacent rather than directly interchangeable.

## One-Sentence Product Definitions

### My Mate

`My Mate` is a mission workspace and human-in-the-loop control product for
long-running agent work, with mobile-first supervision and desktop
orchestrator tooling, designed to sit above an execution runtime such as
OpenClaw.

### HomeRail

`HomeRail` is a voice-first local agent orchestration runtime that turns
one-off agent chats into auditable, reusable DAG workflows.

## Shared Ground

There is real overlap.

Both projects care about:

- long-running agent work instead of only one-turn chat
- explicit orchestration rather than opaque black-box sessions
- inspectability and auditability
- reusable workflow structure
- multi-agent coordination

This overlap is strong enough that users may initially group them together.

That is why positioning discipline matters.

## Primary Differences

## 1. Product center of gravity

`HomeRail` is centered on the runtime.

Its public story is built around:

- a DAG runtime
- a CLI
- a voice surface
- generated UI
- Docker-backed worker execution

`My Mate` is moving toward a different center:

- a `Mission Workspace`
- a durable `MissionSpec` / workspace contract
- conversation as a rail rather than the whole shell
- approvals, human input, and runtime intervention
- mobile and desktop supervision surfaces

In short:

- `HomeRail` centers the execution rail
- `My Mate` should center the mission workspace

## 2. System boundary

`HomeRail` is itself the orchestration runtime.

Its public package split includes Manager, Node, Worker, CLI, and UI in one
coherent runtime story.

`My Mate` is better understood as the layer above runtime:

- mission shaping
- route review
- intervention capture
- approval and checkpoint control
- output supervision

This matches the current repository reality:

- `My Mate` explicitly describes itself as built above an existing execution
  kernel
- the repository also explicitly states that it does not yet contain the full
  runtime implementation

That is not a weakness if the positioning is honest.
It only becomes a weakness when `My Mate` is described as if it is trying to be
the runtime itself.

## 3. Human interaction model

`HomeRail` optimizes for minimal human attention:

- voice-first input
- generated UI for glanceability
- narrow human side, wide machine side

`My Mate` should optimize for human supervision and intervention:

- start a task
- inspect the route
- confirm or revise the route
- approve or reject gates
- provide missing input
- intervene while work is running
- collect outputs and checkpoints

That is a different promise.

`HomeRail` reduces attention cost at intake.
`My Mate` should reduce control friction across the full mission lifecycle.

## 4. Primary object

The clearest visible object in `HomeRail` is the workflow or DAG.

The clearest visible object in `My Mate` should be the mission.

That distinction matters because it changes what the user believes the product
is for.

If the visible object is a DAG, the product reads like an orchestration engine.
If the visible object is a mission workspace, the product reads like a task
supervision and delivery surface.

This aligns with the current My Mate direction:

- the product correction already points toward a `Mission workspace with a
  conversation rail`
- the versioned `mission_snapshot` contract already exists as the primary
  workspace truth

## 5. Domain emphasis

`HomeRail` makes a very important public scope decision in its roadmap:

- it is not designed for software engineering or development automation
- it targets results that are easy for a person to judge directly

This creates room for `My Mate`.

`My Mate` already carries product signals and seeded assets for domains such as:

- coding and review
- release approval
- operations
- research
- customer follow-up

So one credible wedge for `My Mate` is precisely where `HomeRail` draws a line:

- software delivery
- operational orchestration
- review-heavy, approval-heavy, intervention-heavy workflows

## Strategic Read

The practical implication is straightforward.

`My Mate` should not try to win a runtime-first comparison against `HomeRail`.

That path would force comparison on:

- runtime maturity
- CLI completeness
- worker orchestration depth
- voice/runtime coherence

Those are `HomeRail`'s current public strengths.

The stronger path for `My Mate` is to win a different comparison:

- which product gives a human the best mission workspace?
- which product gives the best intervention and approval loop?
- which product is strongest on mobile supervision?
- which product is strongest for reviewable, team-facing, long-running work?

## Recommended External Positioning

Recommended one-line description:

`My Mate is a mission workspace and intervention layer for long-running agent work, with mobile-first supervision and human-in-the-loop control.`

Recommended short paragraph:

`My Mate` is not another agent runtime. It is the product layer above runtime:
the place where a user shapes the mission, reviews the route, supervises
execution, intervenes when reality changes, and collects outputs through a
durable workspace. The execution kernel can sit below it; `My Mate` owns the
mission, the checkpoints, and the human control loop.

## Recommended Comparison Answer

When someone asks, "Is this basically HomeRail?", the clean answer is:

`There is overlap in orchestration and auditability, but the products are aimed at different layers. HomeRail is a runtime-first local DAG system. My Mate is the mission workspace and intervention layer above runtime, with stronger emphasis on mobile supervision, approvals, route revision, and human control during long-running work.`

## What My Mate Should Avoid Saying

To reduce positioning confusion, `My Mate` should avoid leading with:

- "another orchestration runtime"
- "a DAG engine"
- "a better workflow runtime"
- "voice-first local orchestration"

Those phrases move the comparison directly onto `HomeRail`'s strongest public
ground.

## What My Mate Should Emphasize Instead

`My Mate` should lead with:

- mission workspace
- durable orchestration contract
- mobile-first supervision
- approvals and human input
- runtime intervention and route correction
- outputs, checkpoints, and delivery visibility

## Bottom Line

`HomeRail` is a serious comparison point, but not a reason to abandon `My Mate`.

It is a reason to tighten `My Mate`'s product story.

The right story is not:

- "we also have orchestration"

The right story is:

- "we are the control and workspace layer for long-running agent work"

That story is more honest to the current repository, better aligned with the
existing `Mission Workspace` direction, and more defensible against a
runtime-first competitor.
