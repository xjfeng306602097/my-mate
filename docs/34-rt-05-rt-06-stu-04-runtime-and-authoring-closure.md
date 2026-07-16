# RT-05, RT-06, and STU-04 Runtime and Authoring Closure

## Scope

This delivery closes three gaps left after RT-04:

- `RT-05`: a Runtime Worker can suspend at a human gate and resume the same
  Job after an operator decision.
- `RT-06`: a handoff can materialize bounded dynamic work, joins wait for all
  generated children, and controls issued during provisioning prevent dispatch.
- `STU-04`: Studio supports direct DAG manipulation while preserving the form
  editor as an accessible deterministic fallback.

## RT-05: Worker-Native Human Gates

### Protocol

`NormalizedExecutionReport.human_gate` carries a stable `gate_id`, gate kind,
summary, optional input schema, and request timestamp. `job.control` now carries
`control_id`, `gate_id`, and an operator payload. The Worker answers every
control with `job.control_ack` and an `applied` or `rejected` result.

The Worker advertises `human-gate.native`, `control.resume`, and per-harness
control support during registration. Unsupported controls are rejected rather
than silently ignored.

### Execution Flow

1. The harness returns a `waiting_human` report with gate metadata.
2. The Worker sends `worker.waiting_human` and suspends event delivery.
3. RuntimeEngine persists a `RuntimeHumanGateRecord` and creates the existing
   approval or human-input inbox record with the same `gate_id`.
4. The operator endpoint resolves the inbox record and calls
   `RuntimeDispatcher.resumeHumanGate`.
5. WorkerRuntimeDispatcher resolves the active lease, sends a gate-bound
   control, and persists the control ID and response payload.
6. The Worker validates Job and gate identity, acknowledges the control, and
   continues the same Job. No new attempt or Manager requeue is created.
7. RuntimeWorkerHub journals the applied/rejected control and updates the gate
   terminal state.

If no native gate or active Worker channel exists, the prior Manager requeue
behavior remains the compatibility path.

### Persistence and Audit

Gate records are stored under `runtime-human-gates/<run_id>/`. They retain Run,
node, Job, Worker, transport, request/response payloads, timestamps, control ID,
and last error. Run events include control sent/failed and Worker
applied/rejected evidence.

## RT-06: Dynamic Fanout and Provisioning Control

### Fanout Contract

The source node declares `config.dynamic_fanout`:

```json
{
  "target_node_id": "worker",
  "source_path": "handoff.content.items",
  "max_items": 32,
  "item_input_key": "fanout_item",
  "index_input_key": "fanout_index"
}
```

At handoff routing, RuntimeEngine resolves the array and replaces the pending
template node with deterministic children. Every child persists source node,
source node-run, handoff, template, item index, and item count provenance. The
template's incoming and outgoing edges are expanded so all children become
parallel-ready and downstream joins depend on every generated child.

Zero items connect the source directly to the former template's downstream
nodes. Cardinality above `max_items`, a non-array source, a missing template, or
an already-started template rejects materialization without partial mutation.
Repeated delivery of the same handoff ID returns the existing children.

Global `max_parallel_nodes` remains authoritative; fanout changes the frontier,
not the dispatch capacity policy.

### Control During Provisioning

DockerWorkerProvisioner tracks queued and active provisioning requests.
Run/node pause or cancel records a cancellation against either state. Active
provisioning checks cancellation before container launch, after launch, after
registration, and after health validation. A cancelled request is cleaned up,
releases capacity, returns a non-retryable failure, and can never reach Worker
dispatch.

Worker registration also publishes a per-harness capability map so the Manager
can distinguish cancel-only harnesses from native resume support.

## STU-04: Direct DAG Manipulation

### Editor State

Studio keeps nodes and edges as the saved source of truth. A bounded history
state stores graph and layout snapshots for undo/redo. Coordinates are persisted
inside `metadata.authoring_layout.positions`, so form edits, reloads, and direct
manipulation reconcile deterministically.

### Interactions

- Drag a node to persist its canvas position.
- Use output and input ports to create an edge.
- Select an edge, then use a node port to reconnect its source or target.
- Edit source/target ports, label, and condition JSON in the edge inspector.
- Delete the selected node or edge with Delete/Backspace.
- Undo with Ctrl/Cmd+Z and redo with Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y.
- Escape cancels a pending connection and clears selection.

Removing a node also removes its incident edges. The existing node and edge
forms remain available for keyboard and accessibility use.

### Validation and Preview

The editor validates missing/duplicate node IDs, missing edge endpoints,
self-edges, duplicate port-aware edges, invalid condition values, and cycles.
Unreachable nodes and exits are warnings. Saving is blocked while topology
errors exist. The canvas shows a patch preview against the last loaded/saved
snapshot: added, removed, and changed nodes plus added and removed edges.

## Acceptance Coverage

- WebSocket test proves no completion before resume and completion of the same
  Job after a matching gate control.
- Dispatcher test proves persisted native gate payload/control delivery.
- Fanout tests cover zero, multiple, overflow, stable identity, provenance,
  duplicate handoff, and join edge expansion.
- Provisioner tests cover queued and active cancellation and verify no health or
  dispatch continuation after cancellation.
- Studio model tests cover history, validation, cycles, conditions, and patch
  preview. Studio syntax and shared layout checks remain mandatory.
