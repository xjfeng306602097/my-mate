# M9: Memory Activation, Feedback, and Guided Onboarding

Status: completed (2026-07-17)

M9 turns the M1-M8 Memory subsystem into a measurable user-facing learning loop. M8 can retrieve and recommend relevant canonical Memory, but it does not yet persist exact per-turn usage, capture user feedback, support a session-only recommendation action, or help a new user establish useful Memory without understanding the advanced data model.

## Product Outcome

After M9, a user can establish working preferences during setup, see why a Memory is relevant inside the current Task, use or dismiss it with one action, and inspect which exact Memory versions were supplied to each model turn. My Mate can measure recommendation precision and outcome correlation without storing Private content in analytics or claiming unsupported causal impact.

## Design Principles

1. Canonical `MemoryRecord` remains the only durable source of reusable truth.
2. The frozen `CoreMemorySnapshot` is never rewritten after Session creation.
3. Every model turn receives an immutable `TurnMemoryContextSnapshot` that records the exact Memory versions actually supplied.
4. Session-only use and dismissal do not mutate canonical Memory.
5. Explicit canonical edits and forgetting continue through the existing autonomy and review policy.
6. Private content uses the M8 encryption path and never appears in feedback, observability, supervision alerts, or external analytics.
7. Guided onboarding is optional, resumable, and never scans a local Workspace without an explicit user selection.

## Scope

### 1. Turn Memory Context Ledger

Create one immutable context snapshot immediately before each provider turn:

```ts
interface TurnMemoryContextSnapshot {
  schema_version: 1;
  context_id: string;
  workspace_id: string;
  session_id: string;
  source_user_message_id: string;
  provider_connection_id: string | null;
  model: string | null;
  entries: Array<{
    memory_id: string;
    memory_version: number;
    source: "core_snapshot" | "automatic_recall" | "manual_overlay";
    scope_kind: MemoryScopeKind;
    kind: MemoryKind;
    sensitivity: "normal" | "private";
    content: string;
    content_digest: string;
  }>;
  character_count: number;
  prompt_digest: string;
  created_at: string;
}
```

The complete snapshot is encrypted when it contains Private Memory. Public observability stores only IDs, versions, source, counts, digests, and latency. Provider retries and automatic continuation reuse the same context snapshot so a resumed task cannot silently receive different Memory.

This ledger replaces the current inferred meaning of `applied_automatically`. A recommendation is applied only when its exact ID and version appear in a persisted turn context.

### 2. Session Memory Overlay

Add a session-scoped overlay for deliberate, non-canonical context choices:

- `Use next reply` queues the selected Memory version for the next provider turn.
- The queued entry is consumed exactly once when that turn context is frozen.
- `Keep for this Task` keeps the entry active for later turns in the same Session.
- `Remove from Task` revokes the overlay without deleting canonical Memory.
- If the canonical version changes, the UI reports that the overlay is stale and asks the user to use the newer version or keep the frozen one.

Overlay actions are context reads, not external side effects. They are available in every autonomy mode and remain auditable. Editing or deleting the canonical record still follows Review First, Assisted, or Autopilot policy.

### 3. Recommendation Feedback

Each recommendation receives a deterministic opaque ID derived from Session ID, Memory ID/version, and query digest. Feedback is stored without Memory content:

```ts
type MemoryRecommendationFeedbackAction =
  | "use_next_turn"
  | "keep_for_session"
  | "dismiss_for_session"
  | "not_relevant"
  | "edit_requested"
  | "forget_requested";

interface MemoryRecommendationFeedback {
  schema_version: 1;
  feedback_id: string;
  recommendation_id: string;
  workspace_id: string;
  session_id: string;
  memory_id: string;
  memory_version: number;
  action: MemoryRecommendationFeedbackAction;
  reason_code: "useful" | "wrong_task" | "outdated" | "incorrect" | "too_sensitive" | "other" | null;
  actor_id: string;
  created_at: string;
}
```

Dismissal suppresses the same Memory version only for that Session. A newer canonical version may be recommended again. `not_relevant` becomes a bounded ranking signal; it never changes canonical content automatically.

### 4. Guided Memory Onboarding

Onboarding appears after the first verified Provider Connection or when Memory Center has no active User/Workspace Memory. It is also manually restartable from Memory Center.

The optional flow has four short steps:

1. response and communication preferences;
2. validation and delivery conventions;
3. optional Project-specific conventions after selecting a registered Project;
4. privacy review and confirmation.

Explicit answers may create User or Workspace Memory directly because the user is deliberately stating them. Content inferred from selected documents or prior Sessions is always shown as candidates before commit. The flow can import the existing JSON/JSONL bundle format, but it never crawls a directory or sends files to a model without explicit selection.

Onboarding state is stored per principal and Workspace with `not_started`, `in_progress`, `completed`, and `dismissed` states. Dismissal prevents repeated prompts while keeping the manual entry point available.

### 5. Ranking and Effectiveness

M9 adds bounded feedback features to the existing lexical/semantic score:

- exact-version Session dismissal removes the candidate;
- prior `not_relevant` feedback applies a small capped penalty;
- prior explicit use applies a small capped boost;
- scope, recency, importance, confidence, and retrieval evidence remain visible in the explanation;
- Private content never contributes to a persisted feature vector.

Effectiveness metrics include recommendation actions, dismissal rate, accepted-use rate, stale overlay rate, context assembly latency, and the share of completed Tasks whose scorecard/evaluation can be joined to Memory usage. Outcome reporting is correlation only; M9 does not claim that Memory caused a quality change.

## API Contract

```text
GET  /api/memory-onboarding
POST /api/memory-onboarding/start
POST /api/memory-onboarding/preview
POST /api/memory-onboarding/complete
POST /api/memory-onboarding/dismiss

GET  /api/sessions/:sessionId/memory-recommendations
POST /api/sessions/:sessionId/memory-recommendations/:recommendationId/feedback
POST /api/sessions/:sessionId/memory-overlay
GET  /api/sessions/:sessionId/memory-overlay
DELETE /api/sessions/:sessionId/memory-overlay/:overlayId
GET  /api/sessions/:sessionId/memory-contexts
GET  /api/sessions/:sessionId/memory-contexts/:contextId

GET /api/memory-effectiveness
```

The recommendation response gains `recommendation_id`, `application_state`, `last_applied_context_id`, and `available_actions`. Gateway routes and generated OpenAPI types are mandatory in the same change that adds each Control Plane route.

## Studio Experience

### Task Surface

Relevant Memory belongs near Conversation, not only under Advanced Memory. Use a compact row above the composer or in the Task workboard with:

- scope/kind and concise summary;
- one-line relevance explanation;
- `Use next reply` as the primary command;
- a compact menu for keep, dismiss, edit, and remove-from-Task;
- an `Applied` state linked to the exact turn context.

Actions update the recommendation row locally and must not reload the Session workspace or rebuild the entire Conversation DOM.

### Memory Center

Memory Center adds:

- onboarding status and restart;
- recommendation feedback and application metrics;
- per-Task applied Memory history;
- stale overlay review;
- exact context inspection with Private content visible only to its owner.

The onboarding flow uses a modal or dedicated unframed step surface. It does not expand into the sidebar and does not add Workspace directory configuration to Settings.

## Security and Retention

- Turn contexts containing Private Memory use the same AES-256-GCM key resolution and AAD binding as M8.
- Feedback, metrics, audit events, and recommendation IDs never contain Memory content.
- Restricted Memory remains excluded from automatic recall, recommendations, onboarding suggestions, and overlays.
- Soft deletion removes a Memory from future contexts but does not rewrite historical encrypted turn evidence.
- Owner-only physical purge and cryptographic erasure remain a separate retention milestone and must not be implied by the M9 `forget_requested` action.
- Selected-file onboarding uses the existing Desktop capability boundary and attachment limits.

## Delivery Plan

### M9.1: Usage Foundation

- `TurnMemoryContextSnapshot` store and encryption
- provider-turn integration, retry/continuation reuse, and exact application state
- API and tests for per-turn context inspection

### M9.2: Overlay and Feedback

- session overlay lifecycle
- deterministic recommendation IDs
- feedback store, suppression rules, and audit events
- Task recommendation actions without full workspace reload

### M9.3: Guided Onboarding

- onboarding state and explicit preference capture
- candidate preview for selected files and historical Sessions
- JSON/JSONL import reuse
- desktop/mobile Studio flow

### M9.4: Ranking and Effectiveness

- bounded feedback reranking
- effectiveness metrics and quality joins
- expanded multilingual recommendation and onboarding fixtures

### M9.5: Contracts and Acceptance

- Gateway, OpenAPI, generated types, observability, and documentation
- Control Plane and Studio regression
- provider retry/continuation determinism tests
- desktop and 375 x 844 browser acceptance

## Acceptance Gates

M9 is complete only when:

1. every provider turn can identify the exact Memory IDs and versions it received;
2. a manually queued recommendation is consumed exactly once and survives retry/continuation without drift;
3. dismissing a recommendation suppresses only that Session and version;
4. a new canonical version is eligible again with an updated explanation;
5. onboarding can be completed, resumed, skipped, and restarted without scanning files implicitly;
6. Private content is absent from feedback, audit summaries, metrics, and plaintext turn-context storage;
7. recommendation and context assembly remain within a 100 ms local p95 target at 500 active memories;
8. recommendation actions do not trigger a full Task workspace render or reset Conversation scroll;
9. effectiveness reporting distinguishes correlation from causation;
10. full checks, package tests, Gateway coverage, contract drift checks, and desktop/mobile browser QA pass.

## Completion Evidence

- Control Plane regression: 323 passed, one optional test skipped, zero failures.
- Focused M9 coverage: five tests cover immutable turn contexts, overlays, feedback, onboarding, Private encryption, and the 500-Memory recommendation benchmark.
- Provider coverage: six tests pass, including exact `memory_context_id` evidence and retry/continuation reuse.
- Gateway regression: 35 tests pass, including the complete M9 route allowlist.
- Studio syntax, interaction/model suites, and layout checks pass.
- Browser acceptance passes on desktop and 375 x 844 viewports with no horizontal overflow or console errors. Guided onboarding can start, advance, and dismiss; `Use next reply` updates the exact recommendation locally while preserving Task content and scroll position.
- The local 500-active-Memory benchmark remains below the 100 ms p95 acceptance target.

## Explicit Non-Goals

- model fine-tuning from user feedback;
- cross-Workspace or public Memory sharing;
- autonomous crawling of local files, browser history, email, or connected SaaS;
- silently rewriting the frozen Core Memory snapshot;
- storing credentials or restricted content as Memory;
- a third-party Memory marketplace;
- physical purge, key rotation, backup recovery, and cryptographic erasure, which require a separate operational security design.
