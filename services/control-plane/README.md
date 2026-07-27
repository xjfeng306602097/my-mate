# Control Plane

The Control Plane is the source of truth for My Mate tasks, agent definitions,
orchestration decisions, DAGs, schedules, approvals, memory, artifacts, and
runtime evidence. Clients use it through the API Gateway; Desktop starts it as
a managed local service.

## Runtime model

The active runtime is native to My Mate:

- `AgentDefinition` describes an agent's role, model binding, skills, tools,
  memory policy, budget, and autonomy policy.
- `AgentBindingSnapshot` freezes the effective definition used by a task or DAG
  node so later edits cannot change an in-flight run.
- `MissionSpec -> OrchestrationDecision -> DagProposal -> AgentDag` is the
  canonical planning and compilation path for direct, template, dynamic, and
  manually edited execution.
- `AgentRun`, `AgentTask`, `AgentResult`, and artifact references record the
  durable parent-child execution lifecycle.
- `RuntimeWorkerJob` is the provider-neutral dispatch contract.

Legacy profile, workflow, and provider-specific records are accepted only at
storage migration boundaries. New writes always use the native contracts.

## Execution targets

- `local` executes trusted, bounded operations on the Desktop-selected
  workspace through capability-scoped bridges.
- `docker-worker` executes risky or isolated work inside the pinned Runtime
  Worker image with an explicit workspace mount.
- Provider harnesses run model-native agent loops for Codex, Claude Agent SDK,
  Anthropic-compatible GLM, and Kimi while emitting the same evidence protocol.
- Artifact Worker handles document, spreadsheet, PDF, and other generated-file
  workloads in an isolated container.

The runtime target does not own orchestration state. Scheduling, retries,
approvals, leases, cancellation, checkpointing, compaction, and recovery remain
Control Plane responsibilities.

## Main surfaces

- sessions and conversation tools
- Agent V2 definitions, versions, bindings, teams, and capability resolution
- mission interviews, execution-shape decisions, and orchestration policy
- DAG proposals, compiled DAGs, leases, gates, patches, and run supervision
- workspace authorization, change sets, review, diff, and artifact publishing
- user schedules, model selection, notifications, and scheduled execution
- memory recall, extraction, checkpoints, recommendations, and policy
- skills, plugins, MCP registrations, browser capabilities, and governance
- diagnostics, traces, scorecards, replay, recovery, and cost projection

## Storage

File-backed JSON is the default development backend. SQLite is available for
durable local deployments. Runtime storage is rooted by
`MY_MATE_CONTROL_PLANE_DATA_DIR`; packaged Desktop supplies a directory under
its user-data location.

Sensitive credentials are never persisted in provider records. Connections
store credential environment-variable references, and Desktop/runtime hosts
resolve the values at execution time.

## Development

```powershell
npm install
npm run check
npm test
npm run build
npm start
```

Run these commands from `services/control-plane`. From the repository root,
`npm run check` and `npm test` cover all active packages.

Important development environment variables:

- `MY_MATE_CONTROL_PLANE_PORT`
- `MY_MATE_CONTROL_PLANE_DATA_DIR`
- `MY_MATE_EXECUTION_ADAPTER=local`
- `MY_MATE_ENABLE_LOCAL_EXECUTION=true`
- `MY_MATE_RUNTIME_DEFAULT_TARGET_KIND=local|docker-worker`
- `MY_MATE_RUNTIME_WORKER_IMAGE`
- `MY_MATE_ARTIFACT_WORKER_IMAGE`
- `MY_MATE_DESKTOP_BRIDGE_TOKEN`

## Verification

The Control Plane test suite covers:

- storage migration into native Agent bindings
- direct, template, dynamic, and manual DAG compilation
- schema validation, leases, retries, cancellation, and recovery
- Desktop workspace authorization and reviewed change application
- conversation tool convergence, context compaction, and long-task checkpoints
- schedule creation and time-driven execution
- memory extraction and recall policy
- provider-neutral Runtime Worker dispatch and artifact publication

The repository release checks additionally reject retired adapter sources,
provider harnesses, fixtures, and schemas from Desktop staging.
