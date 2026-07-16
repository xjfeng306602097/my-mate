# MW-04 and LIVE-01 Materializer and Live Acceptance Closure

## Scope

This delivery closes two production-verification gaps:

- `MW-04`: Mission Workspace reads are backed by an independently rebuildable,
  evented Mission/Session materializer with checkpoints and consistency checks.
- `LIVE-01`: real Provider and model-judge checks have an explicit,
  credential-aware acceptance lane that remains separate from deterministic
  unit and release checks.

## MW-04: Evented Mission Materializer

### Storage Model

The materializer owns three independent stores under `MY_MATE_DATA_DIR`:

- `mission-materializer-events/<session-id>/`: ordered immutable source events.
- `mission-materializer-checkpoints/<session-id>.json`: reducer state and the
  projection at a durable sequence.
- `mission-materializer-projections/<session-id>.json`: the latest read model,
  source digest, projection digest, and checkpoint position.

Materializer version `1` consumes four event kinds:

- `session.replaced`
- `message.upserted`
- `workspace_state.replaced`
- `run_route.replaced`

Each event has a monotonic per-Mission sequence and a deterministic
`source_key`. Re-synchronizing unchanged canonical state is idempotent. Changed
Session, message, workspace, or route inputs append a new event rather than
mutating prior history.

### Read And Rebuild Flow

1. The Control Plane resolves the canonical Session, ordered messages,
   workspace state, and latest Run route.
2. Missing source versions are appended to the Mission event log.
3. The reducer resumes from its checkpoint and applies later events in order.
4. The existing `MissionWorkspaceProjection` builder produces
   `missionSpec`, `missionSpecContract`, and `missionSnapshot`.
5. The projection and canonical SHA-256 digests are persisted.
6. Mission list, detail, and Session synchronization continue returning the
   existing workspace contract; Mobile and Studio require no storage-specific
   behavior.

A forced rebuild ignores the checkpoint and derives the projection exclusively
from the Mission event log. Verification independently builds the projection
from current canonical stores, compares canonical digests, and reports drift by
`missionSpec`, `missionSpecContract`, or `missionSnapshot` section.

### Operator Contract

Control Plane and API Gateway expose:

- `GET /api/missions/:sessionId/materializer`
- `POST /api/missions/:sessionId/materializer/rebuild`
- `POST /api/missions/:sessionId/materializer/verify`

The OpenAPI contract and generated shared types cover all three responses. CLI
operations are:

```bash
npm run my-mate -- mission-materializer <session-id>
npm run my-mate -- mission-materializer <session-id> --verify
npm run my-mate -- mission-materializer <session-id> --rebuild
```

Verification exits `3` when drift is detected so an operator or scheduled job
can gate on consistency without parsing display text.

## LIVE-01: Credential-Aware Acceptance

### Studio Provider Configuration Loop

Studio owns the Provider configuration used by live Runtime Workers. The
Registry page shows a Connection list; create and edit actions open a focused
modal with Provider, endpoint, API key, and model IDs. A Connection can expose
multiple models and marks exactly one as the default. Provider presets derive
the common Agent Runtime and protocol; custom protocol, runtime, credential
source, environment name, and metadata remain under Advanced settings.

On a workspace with no active Connection, Studio opens a first-run setup with
two top-level decisions: model setup and environment check. The model step asks
only for Provider, model, endpoint when needed, and API key. Saving creates the
Connection and, when no active Agent Profile exists, a bound `default-agent`.
The environment step runs the existing Doctor probes and separates host-shell
availability from Docker application readiness. Docker image, workspace mount,
and Worker registration evidence remain available under details, so a running
Docker daemon is not misreported as a complete Worker runtime path.

A workspace-scoped Provider Connection persists `agent_runtime`, provider,
protocol, endpoint, model IDs, default model, and credential source metadata.
The `api_key` request property is write-only. For the default managed source,
Control Plane encrypts it with AES-256-GCM in the excluded `provider-secrets`
store. API responses, Connection JSON, RunPlan, RuntimeWorkerJob, evidence,
logs, and storage snapshots never contain the plaintext. Production
deployments should set a stable `MY_MATE_PROVIDER_SECRET_KEY`; local
development generates a private master key. The environment source remains
available for externally managed secrets. URLs containing embedded
credentials, queries, or fragments and metadata keys that could hold secrets
are rejected.

An Agent Profile binds its Agent Runtime and harness profile to an active,
runtime-compatible Provider Connection. RunPlan compilation freezes a
non-secret snapshot, so later Connection edits do not alter an existing Run.
The dispatch envelope and RuntimeWorkerJob retain that snapshot. For managed
credentials, Docker receives a short-lived `--env-file` which is deleted after
provisioning; for environment credentials it receives only `-e <ENV_NAME>`.
Neither mode puts the credential value in Docker command arguments or the Job.

The operator path is:

1. Create a Provider Connection in Studio and enter its endpoint, API key, and
   one or more model IDs. Select environment storage under Advanced settings
   only when the deployment injects that key externally.
2. Choose the default model and save the Connection.
3. Bind an Agent Profile to the Connection and select one of its models.
4. Create a Run; inspect the frozen Connection snapshot in its RunPlan/Job.
5. Verify configuration with `doctor`; opt into a billable live probe only when
   endpoint and credential validation is intended.

```bash
npm run my-mate -- doctor --mode model --runtime glm \
  --provider-connection glm-primary
```

Add `--model-probe` to perform the live Provider request. Doctor output reports
only credential source metadata and configured state. Provider Connection
CRUD is exposed through Control Plane, API Gateway, OpenAPI-generated types,
and the Studio Registry.

### Isolation And Selection

Live checks are intentionally not part of `npm test`. The manifest at
`config/live-acceptance.json` defines Provider harness requirements and the
Anthropic `model-v1` judge. No lane is selected by default, so
`npm run live:acceptance` performs no model request and records `skipped`.

`MY_MATE_LIVE_PROVIDERS=auto` selects only Provider lanes with both a configured
harness and required credential. `MY_MATE_LIVE_JUDGE=auto` does the same for
the judge. Explicitly selecting a lane with missing configuration is a failure,
not a skip. `--require-configured` fails when no lane actually ran.

Supported Provider lanes are `codex`, `claude-sdk`, `glm`, `kimi`, and `openclaw`.
Codex uses app-server JSON-RPC, Claude uses the Agent SDK, and GLM uses the same
Agent SDK through an Anthropic-compatible endpoint. Kimi and OpenClaw retain
their protocol adapters. Command execution is an explicit compatibility
fallback, not the primary Codex/Claude path.

The practical Provider scenario creates a random fixture in an isolated
workspace. The Agent must read it through a tool, return the token and computed
sum, preserve correlated native tool call/result evidence, and report usage.
The judge lane invokes the Anthropic evaluator and requires a structured
verdict with usage.

### Evidence And Secret Handling

Results conform to `schemas/evaluation/live-acceptance-result.schema.json` and
are written to `tmp/live-acceptance/result.json` by default. They include lane,
Provider/model and evaluator identity, credential and harness environment
variable names, duration, revision, status, and a SHA-256 digest of process
output.

Credential values are never serialized. Managed keys are decrypted only into
the in-memory Provider environment or a short-lived Docker env file. Error
messages are redacted against secret-bearing environment variables, and raw
Provider output is not retained in the result artifact.

### CI And Release Policy

`.github/workflows/live-provider-acceptance.yml` supports manual and reusable
execution, builds the Runtime Worker image, runs the selected Codex/Claude/GLM
lanes again inside Docker, and uploads both host and Docker results. Docker
credentials are forwarded by environment variable name and are never included
in `RuntimeWorkerJob`. Runtime Worker release
enables it only when repository variable
`MY_MATE_ENABLE_LIVE_RELEASE_ACCEPTANCE=true`. When disabled, the deterministic
release path remains unchanged. When enabled, an explicitly configured live
lane failure blocks publish.

Example local selection:

```bash
MY_MATE_LIVE_PROVIDERS=auto MY_MATE_LIVE_JUDGE=auto npm run live:acceptance -- --require-configured
```

The required harness, credential, and optional model environment variables are
listed in `config/live-acceptance.json`. A successful no-credential run proves
selection and safety behavior only; it is not evidence that a real Provider or
judge call passed.

Local acceptance on 2026-07-12 proves the Codex app-server lane end to end: one
attempt, verified workspace output, eight native evidence records, one
correlated tool call/result pair, and available usage. The locally authenticated
Claude Bedrock lane reached the Worker-owned 120-second Agent SDK timeout and is
retained as a failed result, not a pass. GLM 5.2 passed both host and Docker
Agent Harness acceptance against an Anthropic-compatible endpoint: workspace
output, native tool correlation, and usage were all verified. The local HTTPS
inspection root was supplied through `NODE_EXTRA_CA_CERTS`; TLS verification
remained enabled.

## Acceptance Coverage

- Materializer unit tests cover idempotent append, incremental reduction,
  checkpoints, event-only rebuild, and section-level drift detection.
- Control Plane integration covers status, consistent verification, and forced
  rebuild against a real Session.
- API Gateway integration covers all three proxy routes.
- CLI tests cover status and drift exit semantics.
- LIVE-01 unit tests cover automatic selection, missing-configuration failure,
  secret redaction, skipped lanes, and digest-only output evidence.
- Provider Connection integration covers workspace isolation, multiple models,
  protocol selection, encrypted managed credentials, credential-env allowlists,
  runtime-compatible Agent binding, immutable RunPlan snapshots, secret-free
  Runtime Jobs, temporary Docker env-file cleanup, Doctor resolution, and
  Gateway/Studio lifecycle behavior.
- The no-credential local command must finish as `skipped` without a model call;
  credentialed Provider/judge success remains an environment-specific release
  acceptance result.
