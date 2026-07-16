# M4: Task Checkpoints and Automatic Continuation

## Outcome

M4 adds a canonical `TaskCheckpoint` state that records where an active Conversation task stopped and how it may continue. It is intentionally separate from:

- `MemoryRecord`, which stores durable facts useful across future tasks.
- Session Recall, which retrieves exact evidence from historical conversations.
- Runtime Worker workspace snapshots, which protect file changes and execution state.

## Hermes Comparison

Hermes persists inbound turns before model execution, uses a bounded iteration budget, and preserves compression continuation lineage. It also has filesystem checkpoints for rollback. My Mate adopts the crash-resilience and bounded-continuation principles, but does not mix filesystem rollback snapshots into Conversation task progress.

My Mate keeps the same Session ID across context compaction. The checkpoint transition log records the compaction boundary and Provider evidence instead of rotating to a child Session.

## Canonical Record

Each Conversation turn creates a checkpoint before model execution. The record contains:

- Workspace, Session, goal, and source user message identity.
- Current status and reason.
- Monotonic version and bounded transition history.
- Progress summary, compacted context summary, and next action.
- Provider finish reason, continuation/tool rounds, compaction evidence, and Action IDs.
- Resume count, maximum resume budget, and autonomy policy.
- Last error identity and terminal timestamps.

Records are stored under `DATA_DIR/task-checkpoints/{workspace}/{session}` through the existing JSON/SQLite storage abstraction.

## State Model

Primary states:

- `in_progress`: persisted before a model turn starts.
- `resumable`: the turn stopped for a recoverable reason.
- `waiting_human`: user input or approval is required.
- `completed`: the turn reached a complete response.
- `failed`: recovery is unsafe or the bounded resume budget is exhausted.
- `superseded`: a new user turn replaced an older continuation path.

Important reasons include context compaction, Provider continuation limit, client disconnect, Provider interruption, Control Plane restart, explicit resume, automatic resume, and resume-budget exhaustion.

## Autonomy Policy

| Mode | Length continuation | Process restart | Explicit resume |
|---|---|---|---|
| Review First | Persist and stop | Persist and defer | Allowed after user action |
| Assisted | Persist and stop | Persist and defer | Allowed after user action |
| Autopilot | Automatically resume | Automatically resume | Allowed |

Automatic continuation is bounded to three checkpoint resume attempts. Exhaustion becomes `failed` and moves the Session to `waiting_human`; it never claims completion.

## Recovery Flow

1. Persist an `in_progress` checkpoint before the Provider call.
2. Persist partial output and Provider evidence when a continuation boundary is reached.
3. For Autopilot, inject a checkpoint resume contract and continue without repeating completed work.
4. On Control Plane startup, convert orphaned `in_progress` records to `resumable`.
5. Automatically resume eligible Autopilot records under a service identity scoped to the original Workspace.
6. Defer Assisted and Review First records until the user invokes explicit resume.

## Interfaces

- `GET /api/sessions/{sessionId}/checkpoints`
- `GET /api/sessions/{sessionId}/checkpoints/latest`
- `POST /api/sessions/{sessionId}/checkpoints/{checkpointId}/resume`

The latest checkpoint is also included in Session detail as `task_checkpoint`. Studio shows a compact paused/waiting state in the Conversation rail and provides a Continue action for resumable checkpoints.

## Remaining Memory Roadmap

- M5: Completed in `docs/56-hybrid-memory-retrieval-and-mempalace-provider.md`.
- M6: Memory review UI, import/export, retention policy, and observability.
