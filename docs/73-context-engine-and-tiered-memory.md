# Context Engine and Tiered Memory

My Mate uses one Context Engine contract for Main Agent and Sub Agent provider turns. The canonical Session transcript, command evidence, Checkpoints, AgentDag state, and artifacts remain durable source data; context assembly never rewrites or deletes those records.

## Turn lifecycle

1. `ingest` derives a bounded working-set query from the Mission goal, current plan, and the three latest user turns.
2. `assemble` allocates the Provider input budget by authority and relevance.
3. `compact` serializes rolling-summary work with a persistent Session lease and preserves the original transcript on failure.
4. `afterTurn` records assembly evidence on the Session.
5. `maintain` applies time decay and tier transitions to durable memory access state.

## Context order

Every Provider turn is assembled from these sources:

1. Agent binding and system policy.
2. Authoritative World State: Mission, Checkpoint, assigned Agent Task, AgentDag state, and node status.
3. Rolling conversation and tool-loop summaries.
4. Activated Core and Working memory selected for this turn.
5. Active Skill instructions and capability catalog.
6. User attachments.
7. Recent raw conversation turns.

World State is server-owned and takes precedence over model-generated summaries. A compression operation may summarize conversation history, but it cannot replace Mission, Checkpoint, Agent Task, or AgentDag state.

## Memory temperature

Memory remains canonical in the existing encrypted Memory store. Temperature is stored separately so existing records and retrieval indexes require no migration.

- `core`: stable, important, or repeatedly activated information.
- `working`: recent and task-relevant information.
- `peripheral`: cold information retained outside the prompt and recalled only when relevant.

Ranking combines retrieval evidence, importance, confidence, activation score, and whether the memory is pinned in the Session snapshot. Successful activation increments access state. Daily maintenance applies tier-specific half-life decay and can demote cold records. Mutable tier scores are not rendered into the prompt, preserving cache stability.

## Compaction safety

- The latest raw tail remains available after rolling-summary compaction.
- Compression uses a per-Session filesystem lease whose default lifetime exceeds the Provider timeout.
- A configured `metadata.context_compression_model` is used only when it belongs to the selected Connection; failure falls back to the primary model.
- Compression failure records diagnostics and keeps the uncompressed messages.
- Tool-loop compaction preserves call/result pairing, prunes oversized results, and suppresses repeated low-yield compaction below 10 percent savings unless the context is near overflow.
