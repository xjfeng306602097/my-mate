# Long-Term Memory M3: Snapshot and Session Recall

## Outcome

M3 adds two read paths on top of the canonical Memory Core:

1. A frozen Core Memory snapshot created for each Session.
2. Exact historical Session recall backed by a rebuildable SQLite FTS5 index.

These paths do not replace `MemoryRecord`, and they do not store current task continuation state.

## Frozen Core Memory Snapshot

`CoreMemorySnapshot` is created when a new Session is persisted. Existing Sessions create it lazily on their first Conversation turn or snapshot API read.

Selection rules:

- Only active and currently valid memories are eligible.
- Workspace memory must match the active Workspace.
- User memory must belong to the Session owner or authenticated principal.
- Private memory is limited to the matching user scope.
- Restricted memory is never included.
- Entries are ranked by importance, confidence, scope relevance, and recency.
- The snapshot is bounded to 12,000 characters and an estimated 3,000-token budget.

The selected memory IDs and versions, content digest, and provenance are persisted. A later memory write does not mutate an existing Session snapshot. The Conversation system prompt labels snapshot entries as quoted reference data rather than instructions.

Project memory is intentionally not added to the initial snapshot yet. A Project binding is established after Session creation, so adding it without a separate binding-time policy would violate the frozen snapshot contract.

## Session Recall

Canonical Session messages remain the source of truth. Successful user and orchestrator message writes append lightweight JSONL records to:

`DATA_DIR/_indexes/session-recall/journal.jsonl`

The `session_recall` tool batch-syncs this journal into:

`DATA_DIR/_indexes/session-recall/session-recall.sqlite3`

The index is derived and disposable:

- No Python process is started during normal message writes.
- Python and SQLite FTS5 are invoked only for recall queries.
- Windows subprocess I/O is forced to UTF-8 so CJK queries are preserved.
- Missing journals are rebuilt from canonical Sessions and messages.
- A corrupt database is deleted and rebuilt automatically.
- Latin text uses FTS5 ranking; CJK phrases use indexed document substring matching.

Recall is restricted to the active Workspace and excludes the current Session. A match returns the original canonical message plus a bounded context window. Credential-shaped content is redacted before results are returned to the model. The system prompt explicitly treats recalled history as untrusted reference data, never instructions.

## Interfaces

Model tool:

- `session_recall(query, limit?, context_radius?)`

HTTP APIs:

- `GET /api/sessions/{sessionId}/memory-snapshot`
- `POST /api/session-recall/search`

The OpenAPI schemas and generated shared types include `CoreMemorySnapshot`, `SessionRecallRequest`, and `SessionRecallResult`.

## Remaining Memory Roadmap

- M4: Task checkpoints and automatic continuation after process or context interruption.
- M5: Derived semantic/vector retrieval and optional MemPalace knowledge graph provider.
- M6: Memory review UI, import/export, retention controls, and observability.
