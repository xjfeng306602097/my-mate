# My Mate Runtime Worker

The Runtime Worker is a standalone daemon used by the Control Plane's Docker
runtime. It connects to the Manager over WebSocket, registers capabilities,
acknowledges jobs, executes a harness, emits ordered worker events and evidence,
and exits when its lease is released.

The stock image is built with a semantic-version tag rather than `latest` and
publishes version, image reference, Git revision, build time, and source through
`GET /health` and Worker registration metadata. The same values are stored as
OCI image labels. It uses the official Node 22 Alpine base and prunes build-only
dependencies before the runtime stage; custom provider images must pass the
same SBOM and Critical vulnerability gate.

## Harnesses

- `local`: deterministic workspace artifact and success handoff.
- `codex`: built-in Codex app-server JSON-RPC harness. The stock Worker image
  includes the pinned Codex binary.
- `claude-sdk`: built-in `@anthropic-ai/claude-agent-sdk` harness.
- `glm`: the Claude Agent SDK harness pointed at a GLM
  Anthropic-compatible endpoint, default model `glm-5.2`.
- `kimi`: Kimi command/stream-json compatibility harness.

Codex and Claude no longer use one-shot commands by default. Set
`MY_MATE_CODEX_HARNESS=command` or `MY_MATE_CLAUDE_HARNESS=command` together
with the corresponding `MY_MATE_*_COMMAND` only for compatibility with a
custom command adapter.

Compatibility command harnesses receive the normalized task prompt on stdin. The complete
`RuntimeWorkerJob` is written under `.my-mate/jobs` in the mounted workspace,
and its path is exposed as `MY_MATE_RUNTIME_JOB_PATH`. Stdout is persisted as a
workspace artifact and included in the success handoff.

Codex app-server notifications and Claude/GLM Agent SDK messages are consumed
as native streams. Kimi compatibility stdout is consumed as JSONL while its
process is running. Stateful Provider adapters aggregate token deltas into
complete text or thinking blocks and preserve stable tool call/result
correlation.
If no known native record is recognized, the command/bridge result uses the
synthetic compatibility path instead of claiming native evidence.

## Evidence Protocol V2

Harnesses execute through the streaming `HarnessClient.execute(job, emit,
signal)` contract. The Worker assigns every emitted record:

- `evidence_schema_version=2` and a monotonic per-job sequence
- provider/model/native-event source metadata
- trace/span/tool-call correlation metadata
- explicit input/output references and nullable usage

Local and unrecognized command fallbacks are explicitly marked
`synthetic=true`. Recognized Codex, Claude SDK, GLM, and Kimi events use
`synthetic=false`. If a recognized stream omits usage, the Worker appends a
synthetic unavailable-usage marker; it never invents zero token counts or cost.

Evidence is redacted before WebSocket transport. Inline payloads above 32 KiB
are written under `.my-mate/evidence` in the mounted workspace and replaced by
a digest, byte size, and workspace reference. The Control Plane performs a
second redaction pass before persistence.

## Environment

- `MY_MATE_MANAGER_WS_URL`
- `MY_MATE_WORKER_ID`
- `MY_MATE_WORKER_TOKEN`
- `MY_MATE_WORKER_LEASE_ID`
- `MY_MATE_WORKSPACE` (defaults to `/workspace`)
- `MY_MATE_WORKER_CAPABILITIES` (comma-separated additions)
- `MY_MATE_RUNTIME_WORKER_VERSION`
- `MY_MATE_RUNTIME_WORKER_IMAGE`
- `MY_MATE_BUILD_REVISION`
- `MY_MATE_BUILD_DATE`
- `MY_MATE_BUILD_SOURCE`

Recorded adapter fixtures run with the normal test suite. A real provider call
is disabled by default. To enable it, set
`MY_MATE_RUN_LIVE_PROVIDER_TESTS=true`, choose `MY_MATE_LIVE_PROVIDER`, and set
the matching command or Harness-specific credential variables. `MY_MATE_LIVE_MODEL` is an
optional source label. Missing live configuration fails clearly once the gate
is enabled.

Agent Harness configuration:

- Codex: `MY_MATE_CODEX_BIN`, `MY_MATE_CODEX_MODEL`, and optional
  `OPENAI_API_KEY`/`CODEX_API_KEY`; an existing Codex agent session is also
  supported for host-side acceptance.
- Claude: `MY_MATE_CLAUDE_MODEL`, `ANTHROPIC_API_KEY`, and optional
  `ANTHROPIC_BASE_URL`.
- GLM: `MY_MATE_GLM_ANTHROPIC_BASE_URL`, one of `GLM_API_KEY`, `ZAI_API_KEY`,
  or `ZHIPU_API_KEY`, and optional `MY_MATE_GLM_MODEL` (default `glm-5.2`).
- Docker secrets are passed by name through
  `MY_MATE_RUNTIME_WORKER_PASSTHROUGH_ENV`; secret values are not embedded in
  the persisted Runtime Job.
- TLS-inspecting environments may set `NODE_EXTRA_CA_CERTS` to a trusted public
  CA bundle. Docker Agent Harness acceptance copies that bundle into its
  isolated workspace; TLS verification remains enabled.

The repository-level credential-aware acceptance runner selects configured
Provider and model-judge lanes, records secret-safe evidence, and remains
separate from the deterministic suite:

```bash
npm run live:acceptance
MY_MATE_LIVE_PROVIDERS=auto MY_MATE_LIVE_JUDGE=auto npm run live:acceptance -- --require-configured
```

With no selected credentials or harnesses, the first command records `skipped`
without making a model request. See `config/live-acceptance.json` and
`docs/35-mw-04-live-01-materializer-and-live-acceptance-closure.md`.

Build and verify:

```bash
npm run runtime-worker:image
npm run runtime-worker:verify-image
npm --prefix services/runtime-worker test
npm run runtime-worker:smoke
MY_MATE_DOCKER_LIVE_PROVIDERS=auto npm run runtime-worker:agent-harness-smoke
```

The Agent Harness smoke runs inside the built Worker image. It passes credentials
to Docker by environment variable name, keeps them out of `RuntimeWorkerJob`, and
requires workspace-derived output, correlated native tool evidence, and usage.
