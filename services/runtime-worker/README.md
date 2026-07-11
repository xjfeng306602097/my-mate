# My Mate Runtime Worker

The Runtime Worker is a standalone daemon used by the Control Plane's Docker
runtime. It connects to the Manager over WebSocket, registers capabilities,
acknowledges jobs, executes a harness, emits ordered worker events and evidence,
and exits when its lease is released.

## Harnesses

- `local`: deterministic workspace artifact and success handoff.
- `codex`: command configured by `MY_MATE_CODEX_COMMAND`.
- `claude-sdk`: command configured by `MY_MATE_CLAUDE_SDK_COMMAND`.
- `kimi`: command configured by `MY_MATE_KIMI_COMMAND`.
- `openclaw`: HTTP bridge configured by `MY_MATE_OPENCLAW_WORKER_BRIDGE_URL`.

Command harnesses receive the normalized task prompt on stdin. The complete
`RuntimeWorkerJob` is written under `.my-mate/jobs` in the mounted workspace,
and its path is exposed as `MY_MATE_RUNTIME_JOB_PATH`. Stdout is persisted as a
workspace artifact and included in the success handoff.

Codex, Claude SDK, and Kimi stdout is consumed as JSONL while the process is
running. Stateful provider adapters aggregate token deltas into complete text
or thinking blocks and preserve stable tool call/result correlation. OpenClaw
normalizes `events` or `evidence` returned by the bridge. If no known native
record is recognized, the command/bridge result uses the synthetic compatibility
path instead of claiming native evidence.

## Evidence Protocol V2

Harnesses execute through the streaming `HarnessClient.execute(job, emit,
signal)` contract. The Worker assigns every emitted record:

- `evidence_schema_version=2` and a monotonic per-job sequence
- provider/model/native-event source metadata
- trace/span/tool-call correlation metadata
- explicit input/output references and nullable usage

Local and unrecognized command/OpenClaw bridge fallbacks are explicitly marked
`synthetic=true`. Recognized Codex, Claude SDK, Kimi, and OpenClaw events use
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

Recorded adapter fixtures run with the normal test suite. A real provider call
is disabled by default. To enable it, set
`MY_MATE_RUN_LIVE_PROVIDER_TESTS=true`, choose `MY_MATE_LIVE_PROVIDER`, and set
the matching command or OpenClaw bridge variable. `MY_MATE_LIVE_MODEL` is an
optional source label. Missing live configuration fails clearly once the gate
is enabled.

Build and verify:

```bash
npm run runtime-worker:image
npm --prefix services/runtime-worker test
npm run runtime-worker:smoke
```
