# My Mate Native Agent Runtime

## Decision

My Mate owns one Agent Runtime. Hermes, Pi, Codex harnesses, and OpenClaw are
design references or model-provider implementations, not interchangeable Agent
Runtime backends.

The canonical execution chain is:

`MissionSpec -> ExecutionShapeDecision -> DagProposal -> AgentDag -> Native Agent Runtime`

## Retained boundaries

- Provider connections normalize model APIs and credentials.
- Capability Registry, Plugin Host, MCP, Skills, and tools extend the Native Runtime.
- Local, Docker, and isolated Workers enforce execution and filesystem boundaries.
- AgentDefinition and immutable AgentBindingSnapshot define role, model, tools,
  skills, memory, context, workspace, autonomy, and sandbox policy.
- AgentDag remains the durable source of truth for dependencies, Human Gates,
  Reviewer results, artifacts, leases, retries, and recovery.

## Retired boundaries

- OpenClaw is no longer a Provider Connection or execution adapter.
- AgentDefinition does not select Pi, Hermes, Codex, or OpenClaw as its runtime.
- Provider family names do not select an Agent harness.
- The legacy Agent Profile hosting editor is not a product configuration surface.

Historical Workflow and OpenClaw fields remain read-only during migration. New
Agent versions always persist `runtime_policy.runtime = "native"`. Historical
Agent versions are normalized to the same value when read.

## Removal sequence

1. Stop new OpenClaw configuration and Native-normalize Agent versions.
2. Remove OpenClaw and deferred harness adapters from runtime registration.
3. Remove the standalone OpenClaw execution-adapter service and dedicated tests.
4. Keep compatibility reads until old Workflow fallback telemetry reaches zero.
5. Remove remaining OpenClaw DTO and OpenAPI aliases in a schema-versioned migration.

The final compatibility-field removal must not rewrite historical Session,
Artifact, Run, or audit records.

## Removal status (verified 2026-07-27)

- Step 1 is done: `provider-connection-store.ts` rejects new OpenClaw
  connections with a retired-provider error, and Agent versions normalize to
  `runtime_policy.runtime = "native"`.
- Steps 2-3 are partially done: runtime registration no longer selects
  OpenClaw, while `services/execution-adapter` still exists for compatibility
  reads.
- Steps 4-5 remain gated on the two open `docs/19` items: compatibility reads
  (`execution-ref.ts`, `types.ts` nullable `openclaw_agent_id`) stay until
  fallback telemetry reaches zero and the schema-versioned migration is
  accepted. Six Control Plane source files still carry compatibility
  references; all are read-only paths.
