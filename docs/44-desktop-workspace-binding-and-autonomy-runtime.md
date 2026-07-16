# Desktop Workspace Binding and Autonomy Runtime

Status: first end-to-end implementation complete

## Policy boundary

Task autonomy and local filesystem authority are independent. Review First,
Assisted, and Autopilot control task progression. A Desktop Workspace Binding
controls which selected folder may be staged into an isolated Run Workspace.
Autopilot can consume an existing capability but cannot create one.

Sessions persist their autonomy mode at creation. Changing the global Studio
setting affects new tasks; changing an active task uses the Session Autopilot API.
The controller exposes `pending_gate` for start confirmation, workspace
authorization, runtime approval, human input, and Change Set review.

## Capability flow

1. Electron persists a Desktop instance id, bridge token, selected folder, and
   opaque folder capability in its user data directory.
2. Studio registers `snapshot-read` after a selected folder is linked to a
   Session.
3. A write-capable route with only read access returns
   `workspace_authorization_required`.
4. Electron presents native confirmation and registers `sandbox-write` through
   an authenticated Control Plane internal endpoint.
5. Public Session responses receive only Binding display state. The host path and
   capability digest remain private.
6. Runs persist `workspace_binding_id`; Runtime Engine resolves the host path at
   dispatch time. Model or public request values cannot override the Binding.

## Runtime and Apply

Workspace-bound Runs use `runtime-workspaces/<run>/project` and a single dispatch
lane. Docker Workers never mount the source directory. A single Change Set is
generated when the Run reaches completion.

Desktop-bound Change Sets cannot use the public Apply route. Studio calls a named
Electron IPC operation, Electron presents native confirmation, and the Control
Plane verifies the Desktop instance, capability digest, Binding status, and
source root. Apply validates all hashes, stages temporary files and backups, and
rolls completed writes back when a later write fails.

## Remaining hardening

- expire and revoke persistent Bindings from a dedicated Settings surface;
- finalize partial Change Sets for failed and cancelled Runs;
- add a durable Run Workspace record with explicit checkpoints and cleanup policy;
- add Git worktree staging for repositories where bounded copying is too costly;
- add Change Set-specific security audit events and optional per-file selection.
