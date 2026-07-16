# M11: Collaborative Memory and External Sync

Status: completed (2026-07-17)

M11 adds controlled Team and Organization Memory without weakening the Workspace security boundary. It also introduces Push and MCP-backed external knowledge ingestion with durable cursors, source bindings, and explicit conflict review.

## Delivered

### Team and Organization collections

- A Workspace can create Team or Organization collections and name the member Workspaces that may receive shared Memory.
- Only normal-sensitivity canonical Memory can be published. Private and restricted content is rejected before a share is created.
- The source Workspace remains the canonical owner. Target Workspaces receive read-only projections, never duplicated canonical truth.
- A share can pin an exact Memory version or follow the latest canonical version.
- Shared projections participate in Core Memory snapshots, automatic recall, turn overlays, and current-Task recommendations under the receiving Workspace's normal context budgets.

### Governed collaboration

- `read_only` shares cannot be edited by a receiving Workspace.
- `suggest_changes` shares let a receiver propose content without mutating the source record.
- Suggestions become source-Workspace conflicts with accept proposed, keep current, merge, and dismiss resolution semantics.
- Pinned shares remain stable and report staleness after the source advances; follow-latest shares update their rebuildable projection.
- Revocation and source deletion remove future visibility without rewriting historical frozen Task evidence.

### External knowledge sources

- Push sources accept bounded, versioned batches with opaque cursors and external record bindings.
- MCP sources invoke an enabled registered server/tool, persist the next cursor, and reuse the same ingestion and conflict path.
- New external records become canonical Workspace Memory with source provenance and may be automatically published to an owned collection.
- Local edits are never overwritten silently. A newer external version or deletion creates a reviewable conflict.
- Secret-like MCP tool arguments are rejected and source status exposes operational metadata without Memory content.

### Operations and product surface

- M11 records are included in encrypted logical backup/restore, integrity scans, retention-aware cleanup, and hard-purge reference removal.
- Studio Memory Center can create collections, publish Memory, inspect shared projections, suggest changes, resolve conflicts, configure Push/MCP sources, and run MCP sync.
- Form state updates locally while typing, and background Session stream events no longer rebuild a non-Task workspace.
- Gateway permissions, OpenAPI contracts, generated shared types, and route tests cover the complete collaboration surface.

## API

```text
GET   /api/memory-collections
POST  /api/memory-collections
PATCH /api/memory-collections/:collectionId

GET  /api/memory-shares
POST /api/memory-shares
POST /api/memory-shares/:shareId/revoke
POST /api/memory-shares/:shareId/suggest

GET  /api/memory-conflicts
POST /api/memory-conflicts/:conflictId/resolve

GET  /api/memory-external-sources
POST /api/memory-external-sources
POST /api/memory-external-sources/:sourceId/ingest
POST /api/memory-external-sources/:sourceId/sync
```

## Acceptance Evidence

- Four focused M11 tests cover Team projection, snapshot and overlay use, suggestion conflicts, Private sharing rejection, external update/deletion conflicts, idempotent replay, and HTTP APIs.
- Control Plane regression: 333 passed, one optional live test skipped, zero failures.
- Gateway regression: 37 passed, including all M11 allowlisted routes.
- Shared type generation and Studio checks pass.
- Browser acceptance created a Team collection and Push source through Studio. Full renders remained stable while Session stream events continued in the background.
- Desktop `1440` and mobile `375 x 844` layout checks found no page-level horizontal overflow; the viewport override was reset.

## Non-Goals

- Public, anonymous, or marketplace Memory publishing.
- Sharing Private or restricted Memory across Workspace boundaries.
- A second canonical copy in every receiving Workspace.
- Silent last-writer-wins conflict resolution.
- Credentials embedded in external source arguments.
- Real-time collaborative document editing or centralized cloud synchronization.
