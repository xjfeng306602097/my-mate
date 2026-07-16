# M5: Hybrid Memory Retrieval and Optional MemPalace Provider

M5 adds rebuildable hybrid retrieval to canonical long-term memory and defines
an optional MemPalace knowledge graph boundary.

## Ownership boundary

`MemoryRecord` remains the only canonical long-term-memory source. The SQLite
search database, embedding vectors, and knowledge graph triples are derived
data. They may be removed and rebuilt without losing canonical memory.

The Conversation tool `memory_search` now uses the same retrieval service as
the management API. There is no separate Conversation-only search branch.

## Local hybrid retrieval

Every canonical memory mutation appends a versioned record to:

`DATA_DIR/_indexes/memory-retrieval/journal.jsonl`

The Python helper maintains:

`DATA_DIR/_indexes/memory-retrieval/memory-retrieval.sqlite3`

Ranking combines:

1. SQLite FTS5/BM25 and exact substring evidence.
2. Deterministic multilingual word and character n-gram cosine similarity.
3. Reciprocal-rank fusion across lexical and semantic ranks.

The n-gram score is reported as `hybrid_lexical_ngram_v1`. It is not described
as a neural embedding. CJK uses character bigrams so recall does not depend on
English tokenization.

Before results become model-visible, the service filters by active Workspace,
principal-owned user scope, sensitivity, status, and temporal validity.
Restricted memory is never returned. Private memory is returned only to its
owning user.

If the journal, database, or an indexed canonical digest is missing, corrupt,
or stale, the service rebuilds from canonical records and retries once.

## Optional embeddings

An OpenAI-compatible provider can rerank visible memories. Privacy filtering
happens before document text is sent to the provider.

Configuration:

```text
MY_MATE_MEMORY_EMBEDDING_PROVIDER=openai-compatible
MY_MATE_MEMORY_EMBEDDING_BASE_URL=https://provider.example
MY_MATE_MEMORY_EMBEDDING_API_KEY=...
MY_MATE_MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MY_MATE_MEMORY_EMBEDDING_DIMENSIONS=1536
MY_MATE_MEMORY_EMBEDDING_TIMEOUT_MS=30000
```

The API key is never written to index metadata. The cache fingerprint contains
only provider kind, endpoint, model, and dimensions. Changing the fingerprint
invalidates the derived vector cache. Provider errors fail open to local
retrieval and are exposed as `embedding_fallback: true`.

## Optional MemPalace knowledge graph

MemPalace is disabled by default and is not a runtime dependency.

```text
MY_MATE_MEMORY_KG_PROVIDER=mempalace
MY_MATE_MEMPALACE_PATH=C:\path\to\palace
MY_MATE_MEMPALACE_PYTHON=python
MY_MATE_MEMPALACE_SYNC_CANONICAL=false
```

The default adapter is read-only. Enabling canonical sync derives one temporal
triple from each eligible memory and stores My Mate provenance separately.
Only provenance-backed triples from the active Workspace are returned. User
and private scope filtering is enforced again before API results are exposed.

Missing `mempalace`, ChromaDB, Python, or a palace path produces an
`unavailable` provider status. It does not affect canonical memory or hybrid
search.

## APIs

```text
POST /api/memory-retrieval/search
GET  /api/memory-retrieval/status
POST /api/memory-retrieval/rebuild

GET  /api/memory-knowledge/status
POST /api/memory-knowledge/query
POST /api/memory-knowledge/rebuild
```

Studio exposes status, search, and rebuild controls under `Advanced > Memory`.

## Verification coverage

M5 tests cover paraphrase recall, CJK, exact lexical evidence, privacy filters,
updated versions, deleted records, corrupt-index recovery, embedding cache
reuse, provider fingerprint invalidation, missing MemPalace fail-open behavior,
management APIs, and Gateway proxy routes.
