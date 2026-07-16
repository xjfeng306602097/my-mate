# Long-Term Memory Core

Status: M1 implemented

## Delivered boundary

My Mate now has a Workspace-scoped canonical store for durable memory. This
slice deliberately stops before Conversation recall so persistence and
governance can be verified independently from model behavior.

The canonical records are:

- `MemoryRecord`: an active, superseded, expired, or deleted durable fact;
- `MemoryCandidateRecord`: a proposed inferred memory waiting for review.

Both use the existing JSON storage abstraction and therefore work with the
file-json and SQLite backends. The records remain the source of truth when a
future FTS, vector, or knowledge-graph index is rebuilt.

## Governance

New Workspace permissions are:

- `memory.read`
- `memory.propose`
- `memory.write`
- `memory.review`
- `memory.manage`

Owners and admins receive every permission. Operators can read, propose, write,
and review. Viewers can only read. Mutating API requests flow through the
existing append-only audit chain.

Explicit writes create `MemoryRecord` objects directly. Inferred or background
writes create candidates. Approval commits the proposed memory and links its id
back to the resolved candidate. A failed candidate update compensates by
removing the newly written memory so the two records do not report conflicting
success states.

Credential-shaped content, private keys, bearer tokens, and common API-key
assignments are rejected before persistence.

## API

```text
GET    /api/memories
POST   /api/memories
GET    /api/memories/:memoryId
PATCH  /api/memories/:memoryId
DELETE /api/memories/:memoryId

GET  /api/memory-candidates
POST /api/memory-candidates
POST /api/memory-candidates/:candidateId/approve
POST /api/memory-candidates/:candidateId/reject
```

Deletion is soft deletion. Updates increment the record version. Default list
queries return active memory only; `status=all` includes deleted and future
lifecycle states.

## Not in M1

The following remain separate milestones:

- frozen Core Memory snapshots at Session creation;
- per-turn FTS and semantic recall;
- historical Session search with anchored message windows;
- background review and autonomy-mode write policy;
- Task Checkpoints and automatic continuation;
- external Memory Providers and MemPalace-derived knowledge graphs;
- Studio Memory Center and Inbox candidate cards.

These features must consume the canonical APIs rather than write directly to
storage directories.
