# M6: Memory Center, Lifecycle, and Background Review

M6 completes the governed long-term memory operating surface introduced in M1-M5. `MemoryRecord` remains the only canonical durable-memory source. Candidates, retrieval journals, SQLite indexes, embedding caches, review records, observability counters, and optional MemPalace triples are derived or governed supporting data.

## Runtime behavior

- Successful Conversation turns run an idempotent background review keyed by the latest user-message digest.
- Assisted and Review First stage inferred memory as a `MemoryCandidateRecord`.
- Autopilot may commit only low-risk inferred memory. Medium/high-risk decisions and all restricted content remain reviewable.
- Exact active-memory and pending-candidate duplicates are suppressed.
- Background review is fail-open: extraction failure never turns a completed Conversation response into a failed turn.
- Project-scoped memory is frozen into a separate Session snapshot extension when a Task Workspace is bound. Existing base snapshot entries never mutate.
- Agent-scoped extraction is opt-in. An explicit Session Agent identity takes precedence; otherwise Conversation uses the stable `default-agent` scope.

## Lifecycle and retention

- Expired canonical memories transition to `expired`; deleted memories transition to `deleted`.
- Restore returns deleted/expired records to `active`, increments the canonical version, and clears terminal validity dates.
- Canonical memory files are never physically deleted by maintenance.
- Resolved candidate files may be physically pruned after the configured retention period.
- Retrieval journals and embedding caches are rebuildable and compacted from the complete canonical dataset.
- The Control Plane runs a bounded maintenance watchdog and also exposes manual maintenance.

## Import and export

- Export supports JSON and JSONL and scans the complete canonical dataset, not the UI's bounded result page.
- Import supports `skip`, `merge`, and `replace`, plus dry-run validation.
- Foreign canonical IDs are never reused. Imported records retain a provenance note for repeat-import matching.
- Workspace and user scopes are remapped to the authenticated destination Workspace/principal.
- Existing secret-content rejection and scope validation remain active during import.
- `replace` soft-deletes the previous imported canonical record before creating a new version lineage.

## Settings and providers

- Embeddings reference an existing active Provider Connection and reuse its encrypted/environment credential source.
- M5 environment-variable configuration remains a compatibility fallback.
- MemPalace remains optional and fail-open. It can be read-only or configured to synchronize eligible canonical records.
- Settings cover background review, automatic recall budgets, Project/Agent scope, retention, embedding, and knowledge graph integration.

## Public API

- `GET|PUT /api/memory-settings`
- `GET /api/memory-observability`
- `GET|POST /api/memory-maintenance`
- `GET /api/memories/export`
- `POST /api/memories/import`
- `POST /api/memories/:memoryId/restore`
- `GET /api/memory-candidates/:candidateId`
- `POST /api/sessions/:sessionId/memory-review`

All routes are explicitly exposed by the API Gateway and represented in the generated OpenAPI types.

## Studio

`Advanced > Memory` is now the Memory Center:

- canonical memory filters, edit, soft delete, and restore;
- pending candidate approval/rejection;
- JSON/JSONL export and dry-run import;
- retrieval/knowledge-provider status and rebuild;
- retention maintenance and observability counters;
- Workspace memory settings backed by the Control Plane.

Pending memory candidates also appear in Inbox so review does not require visiting the advanced surface.

## Verification

The M6 suite covers background-review idempotency and autonomy, Project snapshot freezing, foreign-ID-safe import, export, expiration, restore, Gateway exposure, Studio static checks, and desktop/mobile browser layout.
