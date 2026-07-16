# Desktop Runtime Workspace Context Handoff

Status: implemented

## Outcome

Files explicitly selected with `Use as context` can now move from the Desktop Host boundary into a Runtime Worker job without exposing the original workspace root or using the existing writable `project_local_repo` Docker mount.

## Data flow

```text
Desktop main process
  -> bounded read under selected workspace capability
  -> Session attachment with file URI, relative path, and text snapshot
  -> Control Plane runtime context snapshot
  -> RuntimeWorkerJob.provision.workspace.context
  -> Worker integrity verification
  -> .my-mate/context/<job>/manifest.json
  -> .my-mate/context/<job>/files/<relative path>
  -> Agent Harness prompt points to manifest
```

## Control Plane policy

Only attachments with `metadata.source = desktop_workspace` and a string `desktop_text_content` are eligible. The snapshot applies these limits:

- maximum 16 files;
- maximum 256 KiB per file;
- maximum 1 MiB total content;
- relative paths only;
- duplicate paths resolve to the latest attached version;
- SHA-256 for every file and for the content-free manifest identity.

The Run is linked back to its Session through the persisted RunRoute. A `job.created` event records the schema version, Session id, file count, total bytes, and manifest hash. File contents are not copied into Run events or prompt evidence.

## Runtime Worker policy

Before a Harness starts, the Worker validates:

- supported schema and snapshot mode;
- file-count and byte limits;
- relative path safety;
- file size and SHA-256;
- total size and manifest SHA-256.

Validation failure stops the Job before provider or agent execution. Valid content is materialized into a Job-specific directory. The generated `manifest.json` contains metadata and hashes but not inline content. Materialized files are marked read-only where the host filesystem supports it.

Codex App Server, Claude Agent SDK / GLM, and command Harness prompts instruct the Agent to read the manifest and treat the files as input evidence. Prompt evidence records only the manifest path, counts, byte size, and hash.

## Security boundary

This handoff is a snapshot capability, not a live filesystem mount. The Runtime Worker cannot discover sibling files, follow new paths in the original Desktop workspace, or write back to the original file. A Worker may modify its private copy when operating with elevated local permissions, but such changes do not affect the source workspace and do not change the recorded hashes.

The existing `project_local_repo` mount remains a separate legacy/runtime feature and is not used for Desktop workspace context. It must receive independent read/write permission design before it is exposed through Studio.

## Current mutation handoff

Docker file mutation now uses the isolated copy and Change Set flow documented in `42-risk-routed-runtime-and-sandbox-change-sets.md`, and Studio renders the resulting visual diff with explicit Apply and Reject actions. The next hardening step is to bind Change Set application to a signed durable Desktop workspace capability receipt. Live on-demand reads should still be mediated by the Desktop Host or a local capability service, bind each request to a Session and Job, return content by relative path, and emit an audit event for every read. Git mutation and terminal access remain separate approval-gated capabilities.
