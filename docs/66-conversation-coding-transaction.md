# Conversation Coding Transaction

## Outcome

Conversation coding tasks now use the same review boundary as Runtime Runs. Repository writes never target the authorized source folder directly.

1. The first mutation creates a persistent Session sandbox from the active Desktop Workspace Binding.
2. Reads and searches switch to that sandbox for the remainder of the transaction.
3. File batches use stable idempotency keys, optional expected SHA-256 values, bounded payloads, and rollback on failure.
4. Builds and tests execute in the pinned Runtime Worker Docker image with the sandbox mounted read-write, a persistent dependency cache, and network disabled by default.
5. Provider interruption or tool-round exhaustion leaves the transaction active and resumable.
6. A normal completed turn finalizes all mutations into one visual Workspace Change Set.
7. The source folder stays unchanged until Desktop authenticates the Workspace Binding and applies the reviewed Change Set.
8. Apply checks source hashes, checks reviewed sandbox hashes, stages backups, and rolls back partial failures.

## Conversation Tools

- `workspace_list`: list the source folder or active sandbox.
- `workspace_read_text`: read UTF-8 text from the source folder or active sandbox.
- `workspace_search`: bounded file-name and literal text search.
- `workspace_apply_operations`: batch `write`, `replace`, `delete`, `move`, and `mkdir` in the sandbox.
- `workspace_run_command`: run a structured executable and arguments in Docker. Public dependency access is opt-in and requires one-time Desktop approval.
- `workspace_status`: inspect changed paths, hashes, Change Set state, and the persisted operation ledger.

## Resume Contract

Every mutating batch and command has an `idempotency_key`. A resumed agent calls `workspace_status`, trusts succeeded ledger entries, and continues only unfinished work. Tool-round exhaustion creates a resumable Task Checkpoint instead of finalizing an incomplete Change Set.

## Authorization

Review First approves each sandbox mutation or command before execution. Assisted uses the scoped Workspace authorization for ordinary sandbox work, but escalates large destructive batches and public network access. Autopilot can work freely inside the sandbox, while public network access still escalates. In every mode, local source application remains a Desktop-authenticated Change Set boundary. Public HTTP apply is rejected for any Change Set carrying a local Workspace Binding.

## Regression Coverage

- create, modify, delete, and move in one transaction
- source directory unchanged before review
- idempotent resume behavior
- batch rollback
- isolated command configuration
- 100-file mutation stress
- HTTP Conversation tool loop to Change Set
- public apply rejection and Desktop apply
- existing concurrent edit conflict and partial apply rollback tests
