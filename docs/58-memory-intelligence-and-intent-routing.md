# M7: Memory Intelligence and Intent Routing

M7 upgrades long-term memory from deterministic post-turn extraction to a governed, model-assisted subsystem. Canonical `MemoryRecord` files remain the only durable source of truth. Model output is always a proposal and must pass scope remapping, confidence checks, mutation policy, and the existing autonomy mode before it can change canonical memory.

## Conversation Intent Router

- Every Conversation message first passes through one structured deterministic router.
- Routes contain intent, confidence, source, safe scalar entities, risk, required capability, directive text, and reason.
- High-confidence routes never spend a model call.
- Low-confidence routes may use the configured Memory Intelligence model when model routing is enabled.
- Invalid JSON, low confidence, timeout, or provider failure returns the original deterministic route.
- The built-in English/Chinese fixture suite is exposed through `GET /api/memory-intelligence/evaluation` and reports accuracy, average confidence, per-intent metrics, and individual cases.

## Model-Assisted Memory Review

- `deterministic` remains the compatibility default; `hybrid` enables model review of the complete latest turn within a configured character budget.
- Intelligence can reuse the Session Conversation Provider or select a dedicated verified HTTP Provider Connection and model.
- Internal intent and extraction calls disable Conversation tools and automatic recall.
- The model sees only active memories visible to the current User, Workspace, bound Project, and enabled Agent scope.
- Output must satisfy the strict `create`, `update`, `supersede`, `delete`, or `ignore` JSON contract.
- Requested scopes are remapped to authenticated identities. Unknown targets, cross-scope mutation, restricted content, and sub-threshold proposals are rejected.
- Exact duplicates become `ignore`; strongly similar creates are consolidated into `update`.
- Provider and parsing failures fall back to deterministic extraction without failing the completed Conversation turn.

## Mutation Semantics

- `create` adds a new canonical record.
- `update` preserves the canonical ID and increments its version.
- `supersede` creates a replacement with `supersedes_memory_id` and atomically moves the prior active record to `superseded`.
- `delete` performs an auditable soft delete.
- `ignore` creates no candidate and changes no canonical record.

Review First and Assisted stage inferred changes as candidates. Autopilot can commit only changes permitted by the existing memory risk policy. Candidate approval uses the same canonical mutation functions and rollback boundaries as direct policy-approved commits.

## Automatic Recall

- Normal server-side provider turns retrieve memory for the latest user request before model invocation.
- Retrieval is limited to the current Workspace, authenticated User, bound Project, and current Agent when Agent Memory is enabled.
- Result count and character budgets are enforced before injection.
- Recalled text is labeled as untrusted quoted reference data, never instructions.
- Retrieval failures are fail-open and are recorded in observability.
- Internal classifier and extractor calls explicitly disable recall to prevent recursive context expansion.

## Settings and Observability

Memory Center now configures extraction mode, model intent routing, Intelligence Provider Connection/model, turn budget, confidence threshold, timeout, background-review thresholds, and automatic-recall budgets. Existing scope, retention, embedding, and knowledge-graph settings remain available.

Persisted counters cover:

- model extraction attempts, successes, fallbacks, and proposed operations;
- automatic recall queries, hits, and failures;
- intent model attempts, successes, and fallbacks;
- existing retrieval, candidate, transfer, and maintenance metrics.

The Control Plane, API Gateway, OpenAPI contract, generated shared types, and Studio all expose the same M7 settings and metrics.

## Verification

The M7 suite covers multilingual deterministic routing, strict model route parsing, model refinement and failure fallback, model-assisted extraction and deterministic fallback, all five mutation semantics, supersede lineage, User/Agent recall isolation, character budgets, observability counters, generated contract drift, and Studio rendering.

Verified on 2026-07-16 with 312 Control Plane tests passing and one opt-in live-provider test skipped, Gateway 34/34, CLI 19/19, Runtime Worker 26 passing with one opt-in live-provider test skipped, shared-type drift checks, Desktop and Studio checks, plus desktop and 375 x 812 browser acceptance with no page overflow or console errors.
