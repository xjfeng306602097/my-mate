# My Mate CLI

`@my-mate/cli` operates and verifies runs exclusively through API Gateway. The
Control Plane remains the source of truth for scheduling, evidence, settling,
and scorecard verdicts.

## Build And Run

From the repository root:

```bash
npm run build:runtime
npm run my-mate -- --help
```

During CLI-only development:

```bash
npm --prefix apps/cli run build
node apps/cli/dist/src/index.js --help
```

## Configuration

The default Gateway URL is `http://127.0.0.1:4030`. Configuration precedence
is command line, environment, config file, then defaults.

- `--base-url <url>` or `MY_MATE_BASE_URL`
- `--api-key <token>` or `MY_MATE_API_KEY`
- `--workspace <id>` or `MY_MATE_WORKSPACE_ID`
- `--config <path>`; default `%USERPROFILE%/.my-mate/config.json` on Windows
  and `~/.my-mate/config.json` elsewhere

Config file example:

```json
{
  "base_url": "http://127.0.0.1:4030",
  "api_key_env": "MY_MATE_API_KEY",
  "workspace_id": "alpha"
}
```

The token is sent as a Bearer credential and is never included in CLI output.
Prefer `api_key_env` over storing `api_key` in the file.

Inspect the authenticated principal, memberships, and audit chain:

```bash
npm run my-mate -- --workspace alpha whoami
npm run my-mate -- --workspace alpha workspaces
npm run my-mate -- --workspace alpha audit
```

Operate Registry governance through the Gateway:

```bash
npm run my-mate -- governance list --status pending
npm run my-mate -- governance policy --mode enforced --required-approvals 1 --self-approval deny
npm run my-mate -- governance propose --action agent_profile.upsert --resource-id research-agent --reason "Reviewed profile" --payload '{"name":"Research Agent","status":"active"}'
npm run my-mate -- governance approve <change-id> --comment "Reviewed"
npm run my-mate -- governance reject <change-id> --comment "Needs revision"
npm run my-mate -- governance apply <change-id>
```

`governance propose` requires `registry.manage`. Policy, review, and apply
require `governance.review`. Self-approval is rejected unless the workspace
policy explicitly allows it.

Report effective model cost with explicit evidence completeness:

```bash
npm run my-mate -- cost-report
npm run my-mate -- cost-report --window-hours 168 --status completed
npm run my-mate -- cost-report --group-by model
npm run my-mate -- cost-report --group-by work-package --json
```

Effective cost prefers provider-reported values and uses catalog estimates
only when provider cost is absent. Missing cost remains `unavailable`.

## Commands

Check local or Docker readiness:

```bash
npm run my-mate -- doctor --mode quick
npm run my-mate -- doctor --mode docker
npm run my-mate -- doctor --mode model --runtime codex
npm run my-mate -- doctor --mode model --runtime codex --model-probe
```

`--model-probe` is opt-in because it can make a provider request. Docker
deterministic readiness, model configuration readiness, and live model
verification are reported separately.

Create and optionally follow a published template run:

```bash
npm run my-mate -- run --template-id <template-id> --intent "Run the workflow"
npm run my-mate -- run --template-id <template-id> --intent "Run the workflow" --input topic=runtime --follow --scorecard
```

`--input key=value` may be repeated. JSON values are parsed when valid;
otherwise they remain strings. `--scorecard` requires `--follow`.

Inspect or follow an existing run:

```bash
npm run my-mate -- supervise <run-id>
npm run my-mate -- supervise <run-id> --follow --timeout 120
npm run my-mate -- supervise <run-id> --follow --json-lines
```

Create a persisted pipeline scorecard:

```bash
npm run my-mate -- scorecard <run-id>
npm run my-mate -- scorecard <run-id> --allow-incomplete --json
```

Create an evaluation with independent verdict dimensions:

```bash
npm run my-mate -- eval <run-id> --evaluator none
npm run my-mate -- eval <run-id> --evaluator deterministic-v1 --json
npm run my-mate -- eval <run-id> --evaluator model-v1 --timeout 120
npm run my-mate -- eval <run-id> --evaluator none --require-quality
```

`none` intentionally returns `quality=not_evaluated`. That exits `0` unless
`--require-quality` is supplied. Model evaluation is opt-in, runs outside the
source run, and is polled until its persisted state becomes terminal.

Inspect the first-class trace tree:

```bash
npm run my-mate -- trace <run-id>
npm run my-mate -- trace <run-id> --node <node-run-id> --kind tool --json
```

Audit persisted projections and generate a non-mutating improvement plan:

```bash
npm run my-mate -- replay <run-id>
npm run my-mate -- replay-plan <run-id>
npm run my-mate -- replay-plan <run-id> --scorecard <id> --evaluation <id>
```

Create a linked rerun from the frozen effective plan:

```bash
npm run my-mate -- rerun <run-id> --reason "Retry after review"
npm run my-mate -- rerun <run-id> --reason "Correct input" --input topic=runtime --idempotency-key stable-retry-key
```

`rerun` keeps the original route identity and records `source_run_id`. The CLI
generates an idempotency key when one is not supplied; pass a stable key when a
command may be retried across processes.

Inspect or advance recovery and replay one failed node:

```bash
npm run my-mate -- recovery <run-id>
npm run my-mate -- recovery <run-id> --scan --json
npm run my-mate -- failure-replay <run-id> <node-run-id> --idempotency-key stable-replay-key
```

`failure-replay` creates a new Job from the failed source Job's frozen
plan/input/runtime identity. It does not invoke audit projection replay or
create a linked Run.

## Output And Exit Codes

- `--json` prints one structured result.
- `supervise --json-lines` prints one compact object per poll.
- `0`: operation and requested readiness/verdict succeeded.
- `1`: run, scorecard, evaluation, replay verification, or requested quality gate failed.
- `2`: invalid CLI configuration, arguments, or local command failure.
- `3`: API/connectivity failure or requested Doctor readiness failed.
- `4`: follow timeout or interruption.

## Verification

```bash
npm --prefix apps/cli run check
npm --prefix apps/cli test
npm run runtime-worker:smoke
```

The Docker smoke starts isolated Control Plane and Gateway processes, performs
Doctor through the CLI, runs a two-node Docker Worker workflow, follows it to
terminal settling, persists a pipeline scorecard, runs `eval none`, projects
the trace, verifies exact audit replay, and creates a replay plan. It verifies
deterministic runtime/contract evaluation while explicitly retaining
`quality=not_evaluated`.
