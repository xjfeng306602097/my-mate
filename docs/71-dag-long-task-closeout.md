# DAG and Long-Task Closeout

## Canonical execution path

Session template routes now attempt the canonical chain:

`WorkflowTemplate -> DagDefinition -> DagProposal -> AgentDag -> AgentDagRunner`

Legacy profile/tool names are normalized during compilation (`read`, `write`, `shell`, `list`, and `search` map to the corresponding workspace tools). If an old template cannot resolve an Agent binding, the compatibility Workflow runner remains available and the task is not silently discarded.

## Persistent execution lease

Each running DAG owns a durable record under `agent-dag-leases/<workspace>/<dag>.json` with an owner, lease id, heartbeat, and expiry. Runner instances acquire the record atomically, renew it during execution, and release it on completion or cancellation. A second instance returns `already_running` without creating another AgentRun. Expired leases can be reclaimed after a process crash.

## Verification commands

```powershell
npm --prefix services/control-plane run check
npx tsx --test services/control-plane/test/agent-orchestration.test.ts services/control-plane/test/orchestration-policy.test.ts services/control-plane/test/dag-state-contract.test.ts
$env:MY_MATE_MILLION_TOKEN_MODE = "synthetic"
npm run long-task:million-game
```

The synthetic Desktop/Control Plane pressure test executes 13 tool rounds, four context compactions, one workspace authorization, and reports more than 1.2M cumulative input tokens. The real mode uses the configured Provider Connection and has a bounded timeout; it requires a verified connection and working VPN/network.
