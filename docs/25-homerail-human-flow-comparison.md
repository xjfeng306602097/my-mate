# HomeRail vs My Mate: Human-Flow Runtime Comparison

Date: 2026-07-10

HomeRail reference:

- Repository: `https://github.com/xiaotianfotos/homerail`
- Commit: `a92f8d95962bbba73e9da53b54098bcec087cdbd`
- Build runtime: Node.js 22.12.0, npm 10.9.0, Docker Desktop 4.59.0
- Verification: all package typechecks and production builds passed

This comparison used running products and the same user goal:

> Draft a short checklist for a backend release.

## Test Scope Correction

The verified HomeRail run did not configure or call a model. It used the
template's `offline-deterministic` runtime profile, which replaces every agent
with `agent_type: deterministic` and returns output declared in the template.

That run proves the following HomeRail path:

`Manager -> Node -> Docker Worker -> handoff -> scorecard -> eval`

It does not prove model-provider readiness, model output quality, or the
browser's natural-language Manager Agent flow. Without a Manager model setting,
HomeRail's first-run browser UI disables task submission, and `hr doctor`
reports model and Manager Agent readiness failures. Model-backed HomeRail must
be tested separately after provider configuration.

The passing 9/9 scorecard is therefore a deterministic pipeline-conformance
result. It must not be presented as a semantic quality evaluation of an LLM
answer.

## Compared Flow

1. Install and start the local runtime.
2. Open the browser UI as a first-time user.
3. Submit or create the same two-node Draft -> Review task.
4. Observe the run, Docker workers, node transition, and handoff.
5. Open a completed run and inspect node evidence and artifacts.
6. Review scorecard, evaluation, replay, and trace capabilities.
7. Refine the task after completion.

## Runtime Results

### HomeRail

- Official `offline-deterministic` two-node profile completed in about 2.3 seconds.
- Manager and Node provisioned one Docker Worker per DAG node.
- The run produced 32 events and 2 handoffs.
- The Draft handoff contained a task-specific checklist.
- The Review node received the Draft content as a named input and returned an approval.
- `scorecard` passed 9/9 and `eval-run` returned PASS.
- `replay` incorrectly returned `0/0 (FAIL)` for the same passing run.
- `trace` returned two sessions but no tool calls, despite handoff tool calls existing in chat evidence.

### My Mate Before Runtime-Flow Fixes

- The Docker smoke fixture did not satisfy the current template schema.
- After fixing the fixture, a run marked `completed` without starting a container.
- The configured Docker dispatcher was bypassed by the legacy local execution engine.
- After fixing dispatch ownership, the first Docker node completed but the second ready node was never dispatched.
- After fixing frontier continuation, released workers could be persisted as `connected` because a late heartbeat overwrote the terminal state.
- The Studio mission view crashed on real evidence because `formatDateTime` was undefined.
- Local deterministic artifacts only said that a node completed; they did not contain the requested checklist.
- Handoffs unlocked downstream nodes but did not deliver handoff content into downstream job input.

### My Mate After Runtime-Flow Fixes

- A two-node smoke creates, starts, stops, and destroys two real Docker containers.
- The Docker dispatcher owns run creation when configured, even with a local compatibility adapter.
- A completed source node automatically dispatches a target already made ready by a handoff.
- Released workers remain terminal when late heartbeat or ACK messages arrive.
- The run settles at 0 active jobs, 0 connected workers, and 0 active leases.
- The run retains 10 evidence items, 2 handoffs, and 2 artifacts.
- Handoff content is added to the target job as `input_payload.upstream_handoffs`.
- The deterministic harness supports template-defined output with `{{intent}}` and `{{upstream}}` substitution.
- The smoke now verifies task-specific checklist content and downstream delivery.

Final human-flow verification:

- Session: `sess_20260710T063841882Z_000_tvcr5w`
- Run: `run_20260710T063858581Z_000_ima08d`
- The confirmed `comparison-two-node-v2` route completed both Docker jobs.
- Runtime projection settled at 0 active jobs, 0 connected workers, and 0 active leases.
- The final run retained 12 evidence items, 2 handoffs, and 2 artifacts.
- Review job input contains the Draft handoff and the complete five-step checklist, including `Verify rollback` and `Publish release notes`.
- Studio shows the confirmed `v1 / primary` route, two work packages, two returned outputs, and the Docker runtime dispatcher.

## Human Interaction Findings

### HomeRail Strengths

- The completed-run experience is graph-first and low-noise.
- A run is reachable from Dashboard in one click.
- The full-screen graph makes topology and current node position immediately clear.
- Node drilldown shows chat, handoff port, downstream routing, and raw content.
- The CLI closes the operational loop: `doctor`, `run`, `dag supervise`, `scorecard`, `eval-run`, `replay`, and `trace`.
- First-run setup separates model configuration from host and Docker environment checks.

### HomeRail Weaknesses Observed

- The browser task input is disabled until a Manager model is configured, even though offline CLI DAGs can run.
- The browser evidence view exposes raw JSON and less worker/lease/artifact detail than My Mate.
- Windows startup is fragile around `localhost` versus `127.0.0.1`, OpenSSL availability, and the 15-second health timeout.
- Replay and trace results were inconsistent with the passing scorecard.

### My Mate Strengths

- MissionSpec, checkpoints, outputs, evidence, artifacts, interventions, and context files are available in one workspace.
- The local rule-based orchestrator accepts task refinement without a provider credential.
- Runtime Inspector exposes job, worker, lease, target, handoff, evidence, and artifact identity together.
- Output history and delivery trace are more detailed than HomeRail's current browser UI.

### My Mate Weaknesses Observed

- The main mission view is too dense. The same state is repeated across workspace surfaces, MissionSpec, checkpoints, output ledger, timeline, inspector, and feed.
- Runtime topology is rendered as stacked rows rather than a spatial DAG, making branch and parallel structure harder to scan.
- Direct execution from a template still appears as `Unrouted` with zero work packages, even though a concrete two-node plan ran.
- There is no first-class operator CLI equivalent to HomeRail's doctor/supervise/evaluation loop.
- There is no scorecard, eval-run, replay plan, or useful execution trace contract.

### UI Truth Issues Fixed During Human Operation

- Conversation now removes duplicate orchestrator projections and excludes structural cards such as `summary_card` from the chat rail.
- The mission composer clears only after a successful send.
- Terminal runs display `Completed run` instead of `live run`.
- Runtime health and badges use the configured Docker dispatcher/provisioner rather than the local compatibility adapter.
- Runtime Inspector full-screen positioning no longer depends on its parent layout; desktop screenshot verification found and removed panel overlap.

## Core Gap, Restated

The main gap is not the number of runtime records or panels.

HomeRail currently has a clearer operational product loop:

`configure -> doctor -> run -> supervise -> evaluate -> replay`

My Mate currently has a richer orchestration workspace:

`brief -> plan -> execute -> inspect evidence -> intervene -> review outputs`

To exceed HomeRail, My Mate must combine both. Adding more inspector fields will not close the gap unless the product also gains:

1. A low-attention graph-first runtime view.
2. A deterministic operational CLI and environment doctor.
3. Scorecards, evaluation, trace, and replay as persisted contracts.
4. Consistent route/work-package identity for every run, including direct template runs.
5. Task-result validation, not only transport and lifecycle validation.
6. Cleaner conversation projection and one authoritative status narrative.

## Recommended Priority

### P0: Runtime Truth

- Keep the two-node real-Docker smoke as the minimum runtime acceptance test.
- Validate downstream input content and expected artifacts, not only terminal status.
- Make every UI runtime label derive from the unified runtime projection.
- Project direct template runs as a concrete route instead of `Unrouted`.

### P1: Operator Loop

- Add `my-mate doctor`, `run`, `supervise`, `scorecard`, `eval`, `trace`, and `replay` commands.
- Persist evaluation results so CLI, Studio, and Mobile use the same evidence.
- Add an environment setup surface for Docker, workspace mounts, credentials, and harness readiness.

### P1: Runtime UX

- Make a spatial DAG the primary runtime surface.
- Put worker, lease, evidence, and artifacts in node drilldown.
- Collapse repeated mission sections and retain one authoritative next action.
- Keep structural audit cards out of the primary conversation rail.

### P2: Beyond HomeRail

- Keep My Mate's MissionSpec, route comparison, intervention, context-file, and output-history advantages.
- Add provider-native tool-call, tool-result, usage, and cost evidence.
- Add structured handoff conditions, global worker backpressure, and resumable human gates.
