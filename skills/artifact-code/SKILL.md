# Code Artifact

Use when the requested deliverable is source code or configuration.

1. Inspect relevant Workspace conventions before authoring.
2. Preserve language syntax, encoding, package paths, and existing style.
3. Use `workspace_search` and `workspace_read_text` to gather bounded evidence.
4. Persist repository changes with `workspace_apply_operations` and stable idempotency keys. Never use an artifact script or direct host write for repository edits.
5. Before resuming, call `workspace_status` and skip every succeeded ledger entry.
6. Avoid secrets and machine-specific paths.
7. Run the narrowest relevant build or test with `workspace_run_command`, then inspect `workspace_status` before reporting completion.
8. The source Workspace remains unchanged until the user reviews and applies the final Change Set.
