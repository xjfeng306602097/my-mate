# Desktop Host and Workspace Capability Architecture

Status: implementation spike

## Product shape

My Mate keeps one Studio renderer and gives each surface a different responsibility:

- Desktop is the full local work environment. It owns local service lifecycle and grants narrowly scoped access to user-selected folders.
- Web remains a remote control and collaboration surface. It never assumes access to the user's machine.
- Mobile remains an approval, monitoring, and intervention surface.

The Control Plane remains the source of truth for sessions, plans, approvals, runs, and audit records. Electron is a host and capability broker, not a second backend.

## Process model

```text
Electron main process
  |-- supervises Control Plane (127.0.0.1:6372)
  |-- supervises API Gateway   (127.0.0.1:6373)
  |-- supervises Studio        (127.0.0.1:6374)
  |-- owns native dialogs and workspace capabilities
  `-- creates a sandboxed BrowserWindow
          |
          | explicit, typed preload IPC only
          v
      Studio renderer
          |
          `-- HTTP/WebSocket -> Studio proxy -> Gateway -> Control Plane
```

The supervisor reuses an already healthy local service and only terminates child processes that it started. Services start in dependency order and expose status to the renderer for diagnostics.

## Renderer security boundary

The Studio window uses:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- denied permission requests and denied popup creation
- navigation restricted to the configured local Studio origin

The preload bridge exposes no Node primitives, arbitrary IPC channel, command runner, or generic filesystem method. Every operation is a named capability with structured input and output. Main-process handlers also validate the sender origin.

## Workspace capability

A workspace capability is created only after the user selects a folder in a native dialog. It contains an unguessable identifier and a canonical root path. Every directory listing and file read must present that identifier.

For each request the host:

1. Rejects empty, NUL-containing, device, and absolute relative-path inputs.
2. Resolves the candidate under the canonical workspace root.
3. Resolves symlinks with `realpath`.
4. Rejects any result outside the canonical root.
5. Blocks common credential and private-key paths.
6. Applies entry-count and byte limits.

The first slice supports directory listing and bounded UTF-8 text reads only. Selecting a file as context stores a real `file://` reference plus the explicitly read text snapshot. The snapshot makes the selected content available to the Control Plane without granting the Web renderer general filesystem access.

## Capability policy

| Capability | First slice | Approval requirement |
| --- | --- | --- |
| Select workspace root | Enabled | Native folder picker |
| List files under root | Enabled | Existing workspace grant |
| Read bounded text file | Enabled | Explicit `Use as context` action |
| Write or rename file | Disabled | Future per-operation approval |
| Delete or trash file | Disabled | Future high-risk approval |
| Git mutation | Disabled | Future repository-scoped approval |
| Terminal / PTY | Disabled | Future command policy and audit |

Capability grants are local host state. Session attachments and their content snapshots remain normal Control Plane records, preserving the existing ownership boundary and audit trail.

## Service and failure behavior

- The desktop window is created after all three local services pass their health probes.
- A failed child reports its exit code and recent logs; Electron does not silently fall back to an unrelated remote endpoint.
- Closing the app terminates only managed child processes.
- A stale persisted workspace path is ignored when it no longer exists or resolves to a directory outside its canonical path.

## Next hardening steps

The first Runtime Worker handoff is implemented as a bounded, hashed snapshot documented in `41-desktop-runtime-workspace-context-handoff.md`. Docker mutation now uses a per-Job project copy plus explicit Change Sets and Studio visual review as documented in `42-risk-routed-runtime-and-sandbox-change-sets.md`; the original project is not mounted into the Worker. Remaining hardening includes signed durable Electron permission receipts, per-session and per-Job capability binding, Change Set-specific audit metadata, transactional multi-file rollback, PTY isolation, Git worktree staging, and revocation. Remote workspaces should use the same renderer contract with a different host implementation instead of teaching Studio to access SSH or cloud files directly.
