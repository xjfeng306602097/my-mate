# General Artifact Worker Delivery

## Decision

My Mate does not implement one Conversation renderer per file extension. File delivery uses two execution tiers:

1. UTF-8 text, code, and configuration files use the bounded Conversation fast path.
2. PDF, Word, PowerPoint, media, archives, and arbitrary binary files use a sandboxed Artifact Worker.

XLSX remains on the deterministic Conversation fast path temporarily, but the runtime contract also supports Worker-generated spreadsheets.

## Runtime contract

Every Runtime Worker job receives a dedicated output directory:

```text
.my-mate/outputs/<node_run_id>/
```

The Agent must create real files in this directory. Model text is retained as execution evidence or a diagnostic log; it is not a deliverable.

After execution, the Worker recursively collects regular files and rejects:

- symbolic links;
- path traversal;
- empty files;
- credential and private-key names;
- files, file counts, or aggregate output beyond configured limits.

Collected files become `deliverable` artifacts with `workspace://` storage references. Docker workspaces remain host-readable through the existing bind mount.

## Public delivery

Control Plane resolves a runtime artifact only inside the persisted Worker lease workspace and exposes:

```text
GET /api/runs/:runId/artifacts/:artifactId
GET /api/runs/:runId/artifacts/:artifactId/download
```

API Gateway explicitly exposes both routes and forwards response bytes without converting binary bodies to text.

Studio previews Markdown, source/config text with syntax highlighting, images, and PDFs. Other binary formats show verified metadata and a download action.

## Completion semantics

A file task is complete only when a verified `deliverable` artifact exists. A Worker that exits without a file produces an incomplete-task message instead of a success claim.

On successful Run completion, the Session receives an idempotent orchestrator message containing real download links. Runtime failures are also projected back into the conversation.

Autonomy policy remains authoritative:

- `review_first`: requires review and explicit execution.
- `assisted`: requires a human start action.
- `autopilot`: schedules the Artifact Worker through the existing Autopilot controller and supervises it until terminal state.

## Format behavior

Text/code formats such as `.java`, `.py`, `.properties`, `.xml`, `.json`, `.yaml`, `.js`, `.ts`, `.go`, `.rs`, shell, SQL, and Terraform remain ordinary text artifacts. Unknown binary extensions remain downloadable as `application/octet-stream`; they do not require a new Control Plane implementation.
