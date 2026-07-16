# M8: Memory Production Hardening and Proactive Reuse

M8 hardens durable Memory for production use and makes relevant Memory visible before it becomes stale context. Canonical `MemoryRecord` files remain the only source of truth; retrieval indexes, Core Memory snapshots, recommendations, knowledge triples, and supervision alerts are derived views.

## Private Memory Encryption

- Private canonical content and tags, candidate proposals and rationales, and snapshots containing Private Memory use AES-256-GCM at rest.
- The key resolves from `MY_MATE_MEMORY_SECRET_KEY`, then `MY_MATE_PROVIDER_SECRET_KEY`, with a local master key under the ignored `memory-secrets` data directory as the development fallback.
- Authenticated additional data binds ciphertext to its record type, Workspace, and record ID.
- Legacy plaintext records are migrated lazily on read and during maintenance without changing their public API shape or canonical content.
- Private Memory never enters the retrieval journal or embedding cache. It remains searchable only through ephemeral in-process matching for its owner.
- MemPalace receives only normal-sensitivity records. Maintenance invalidates legacy Private provenance, and a rebuild invalidates prior external triples before reconstructing the normal-only projection.

## Multi-Workspace Maintenance

- `POST /api/memory-maintenance/sweep` discovers Workspaces from the registry, canonical Memory directories, and settings.
- Each Workspace is evaluated independently against its retention interval and runs under an isolated system Workspace context.
- One Workspace failure does not stop maintenance for the others.
- Results report maintained, skipped, and failed Workspaces plus per-Workspace migration, expiry, pruning, rebuild, and latency data.
- The server watchdog uses the same sweep path.

## Recall Cache and Observability

- Automatic recall uses a generation-aware cache keyed by Workspace, principal, query, filters, and limit.
- Canonical writes and rebuilds invalidate cached results immediately.
- `automatic_recall.cache_ttl_seconds` is configurable from 0 through 3600 seconds; 0 disables caching.
- Persisted metrics cover cache hits/misses, total and last recall latency, maintenance sweeps and Workspace failures, and Private record migrations.

## Explainable Recommendations

- `GET /api/sessions/{sessionId}/memory-recommendations` compares the current goal, latest user message, and Task title with active visible Memory.
- User, Workspace, bound Project, enabled Agent, validity-window, and sensitivity boundaries match server-side recall policy.
- Each recommendation identifies the canonical version, scope, kind, sensitivity, relevance score, explanation, snapshot version, and whether the exact version is already frozen in the Task snapshot.
- Proactive Supervision emits at most one low-noise informational alert when relevant Memory is newer than the frozen snapshot.
- Private recommendation text is available only in the owner-scoped immediate API response and is never persisted in supervision alerts.

## Quality Evaluation

- The deterministic bilingual intent corpus grows from 18 to 36 fixtures.
- The quality endpoint also evaluates eight production-backed Memory operation normalization cases across create, update, supersede, delete, duplicate ignore, consolidation, missing targets, and invalid operations.
- Studio reports both intent and Memory operation quality.

## Product Surface and Contracts

Memory Center adds current-Task recommendations, Private encryption/migration posture, recall cache and latency metrics, multi-Workspace sweep status, cache TTL configuration, and explicit current/all-Workspace maintenance actions. The Control Plane, Gateway allowlist, OpenAPI specification, and generated shared types expose the same M8 contract.

## Verification

Focused M8 coverage verifies encrypted canonical records, candidates, snapshots and journals; plaintext migration; multi-Workspace isolation; cache hits and write invalidation; recommendation relevance and snapshot freshness; HTTP exposure; and absence of Private plaintext in durable supervision alerts.

Verified on 2026-07-16:

- root `npm run check` passed across release scripts, shared types, Runtime Worker, Control Plane, Gateway, CLI, Mobile, Studio, and Desktop;
- root `npm test` completed in 121 seconds with every package passing;
- Control Plane: 319 passed and one opt-in live-provider test skipped;
- API Gateway: 34/34 passed;
- Runtime Worker: 26 passed and one opt-in live-provider test skipped;
- CLI: 19/19 passed; Mobile: 61/61 passed; Desktop: 21/21 passed;
- browser interaction verified a relevant newer recommendation, 75-second recall cache TTL persistence, and an all-Workspace maintenance sweep;
- desktop visual inspection passed, and the actual mobile viewport at 375 x 844 reported `scrollWidth === clientWidth === 375` with no horizontal overflow or console error.
