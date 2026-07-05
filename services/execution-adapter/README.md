# Execution Adapter / OpenClaw Bridge

This service is the bridge between:

- `services/control-plane`
- your Dockerized `openclaw-image` runtime

Current scope:

- `POST /api/v1/dispatches`
- `POST /api/v1/controls`
- `POST /api/v1/dispatches/sweep`
- `GET /api/v1/dispatches`
- `GET /api/v1/dispatches/:dispatchId`
- file-backed dispatch store
- callback delivery back into `control-plane`
- `mock` execution mode for end-to-end integration testing
- `native-agent` host-runtime materialization mode
- `container-exec` live Docker bridge mode for the Dockerized OpenClaw runtime

## Why this exists

Your current `openclaw-image` is not yet a clean external execution API.
The bridge absorbs that mismatch.

Recommended topology:

`my-mate control-plane -> execution-adapter -> openclaw-image`

## Modes

### `mock`

Use for first integration tests.

Behavior:

- accepts dispatch
- sends callback `accepted`
- sends callback `running`
- sends callback `completed`

This lets you verify:

- control-plane adapter wiring
- callback auth
- downstream node unlock
- mobile-facing run progression

### `native-agent`

Current behavior:

- accepts dispatch
- sends callback `accepted`
- sends callback `running`
- materializes a real OpenClaw requirement bundle under the configured runtime root
- runs `register_task.py` against that runtime root
- writes a handoff JSON file with the resulting task metadata

This mode is now the landing point for the real OpenClaw worker implementation.

### `container-exec`

Current behavior:

- accepts dispatch
- sends callback `accepted`
- copies a requirement bundle into the live `openclaw-local` container runtime
- runs container-side `register_task.py`
- writes a bridge handoff JSON file containing:
  - container state path
  - container dispatch file
  - short task
  - real OpenClaw `task_id` when available
- when `MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY=direct-agent`, it also:
  - starts an isolated OpenClaw agent task inside `openclaw-local` using detached `docker exec -d`
  - immediately reports `running`
  - persists the async task/session references into the dispatch store
  - polls container task state in the background until it reaches a terminal state
  - exports the final trajectory from the container session
  - extracts `[AGENT_REPORT]` from `metadata.json` or `events.jsonl`
  - maps report status into `completed / failed / waiting_human`
  - emits bridge artifact metadata for the handoff and final agent report

This is the correct integration mode for your current Dockerized `openclaw-image` deployment.
It bridges into the live runtime volume instead of assuming the host repo is the runtime source of truth.

Current limit:

- the bridge currently supports two runtime shapes:
  - `register-only`: stop after task registration and handoff persistence
  - `direct-agent`: run one isolated agent task and normalize the result through the async poller
- it does not yet rejoin the original architect-controlled multi-stage session graph

## Env Vars

- `PORT=4020`
- `MY_MATE_EXECUTION_ADAPTER_API_KEY=...`
- `MY_MATE_EXECUTION_ADAPTER_MODE=mock|native-agent|container-exec`
- `MY_MATE_EXECUTION_ADAPTER_MOCK_STEP_DELAY_MS=250`
- `MY_MATE_OPENCLAW_GATEWAY_BASE_URL=http://host:18789`
- `MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL=http://host:4315`
- `MY_MATE_OPENCLAW_CONTAINER_NAME=openclaw-local`
- `MY_MATE_OPENCLAW_DOCKER_BIN=docker`
- `MY_MATE_OPENCLAW_CONTAINER_CLI=/home/node/.npm-global/bin/openclaw`
- `MY_MATE_OPENCLAW_CONTAINER_RUNTIME_ROOT=/home/node/.openclaw/.openclaw`
- `MY_MATE_OPENCLAW_CONTAINER_PYTHON=python3`
- `MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY=register-only|direct-agent`
- `MY_MATE_OPENCLAW_CONTAINER_AUTH_PROBE=off|aws-sts|aws-sts-auto`
- `MY_MATE_OPENCLAW_DIRECT_AGENT_TIMEOUT_SECONDS=900`
- `MY_MATE_OPENCLAW_DIRECT_AGENT_THINKING=low`
- `MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL=provider/model`
- `MY_MATE_OPENCLAW_RUNTIME_ROOT=...`
- `MY_MATE_OPENCLAW_RUNTIME_PYTHON=python3`
- `MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG=my-mate`
- `MY_MATE_OPENCLAW_DEFAULT_PROJECT_REPO=...`

## Run

```bash
npm install
npm run dev
```

## Verified local OpenClaw shape

The bridge has now been aligned with the verified local runtime:

- Docker container: `openclaw-local`
- live runtime root: `/home/node/.openclaw/.openclaw`
- architect scripts root: `/home/node/.openclaw/.openclaw/workspace-architect/scripts`
- active project registry: `/home/node/.openclaw/.openclaw/workspace-architect/projects/registry.json`
- exposed host ports:
  - gateway `18789`
  - approval console `4315`
  - web console `7681`

The current direct-agent bridge also relies on these runtime facts:

- container CLI path: `/home/node/.npm-global/bin/openclaw`
- auth preflight is now evaluated against the model/provider actually selected for the direct-agent turn
- non-Bedrock agent runs should not be blocked by expired container AWS SSO state
- session key suffix must be lower-cased for task lookup consistency
- `tasks show --json` is not always clean JSON, so the bridge falls back to tolerant parsing
- trajectory export may require scanning `events.jsonl` when `metadata.json` does not include the final assistant report

## Async direct-agent lifecycle

When `MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY=direct-agent`, the bridge now works like this:

1. `POST /api/v1/dispatches` is accepted.
2. The bridge registers the OpenClaw task inside `openclaw-local`.
3. The bridge starts `openclaw agent ...` with detached `docker exec -d`.
4. The bridge stores:
   - `openclaw_result_session_key`
   - `openclaw_result_run_id`
   - `direct_agent.mode=async-task`
   - poll timestamps and last reported status
5. The bridge sends `running` back to `control-plane`.
6. A background poller:
   - queries `openclaw tasks show --json`
   - falls back to `openclaw tasks list --json` when needed
   - exports trajectory on success
   - extracts `[AGENT_REPORT]`
   - reports `completed`, `failed`, or `waiting_human`
7. On bridge restart, `resumeBackgroundWork()` reattaches pollers for unfinished async dispatches.

The bridge now also performs lightweight startup maintenance for persisted async dispatches:

- normalize stored session keys when historical records kept mixed-case `disp_...` suffixes
- align local `status` with an already persisted terminal `last_reported_status`
- finalize stale failed-launch / stale-poller records instead of leaving them in `running`

For explicit operations, `POST /api/v1/dispatches/sweep` runs the same maintenance logic on demand and returns a summary of normalized, resumed, aligned, and finalized records.

## Verified isolated e2e

The async bridge has been verified in an isolated local topology without touching the main `4010` instance:

- `control-plane`: `http://127.0.0.1:4111`
- `execution-adapter`: `http://127.0.0.1:4120`
- `openclaw-local` gateway: `http://127.0.0.1:18789`
- `openclaw-local` approval console: `http://127.0.0.1:4315`

Verified outcome:

- a real backend single-node run reached `completed`
- the verified isolated bridge pinned `MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL=deepseek/deepseek-v4-pro`
- `control-plane` received:
  - `accepted`
  - async `running`
  - `node.completed`
  - `run.completed`
- artifacts were persisted for:
  - handoff
  - final agent report

Representative successful objects from the latest verified run:

- `run_id = run_20260620T170751513Z_000_mymgm5`
- `dispatch_id = disp_20260620T170751564Z_000_3sv3tc`
- `task_id = b72d07e2-63d5-4472-9322-4fbfb62c715a`
- `sessionKey = agent:backend:explicit:bridge-disp_20260620t170751564z_000_3sv3tc`

## Next implementation step

The next real milestones are:

- add focused tests around callback failure handling inside startup maintenance
- extend sweep responses with per-dispatch operation details when the ops UI needs audit trails
