# M18-M21 Productization Roadmap

## Status

Completed on 2026-07-17. Final acceptance verified the Windows NSIS installer,
compiled packaged services, SQLite storage and file-JSON migration backup,
Artifact versioning and multi-output regression, timezone-aware schedules,
in-app notifications, and the 980px Desktop minimum-width layout. Repository
checks and tests completed with no failures.

## Approved Scope

The current mainline is limited to four milestones:

1. M18 Desktop Production Release.
2. M19 Local Runtime Productization.
3. M20 Artifact Productization Closure.
4. M21 User Cron, Scheduled Tasks, and In-App Notifications.

Messaging channels, voice, meetings, smart-home integrations, media services,
remote plugin discovery, external observability exporters, and Mobile
productization are deferred. Existing generic MCP and local governed Skill
marketplace behavior remains available, but those deferred integrations do not
expand this mainline.

## M18 Desktop Production Release

- Build a Windows installer and unpacked acceptance artifact from the Electron
  shell.
- Run compiled Control Plane and API Gateway code in packaged builds; packaged
  Desktop must not depend on repository TypeScript or `tsx`.
- Bundle the Studio static server and its runtime browser dependencies.
- Add version metadata, release checks, artifact hashing, and a Windows release
  workflow with an explicit signing boundary.
- Keep unsigned local packaging available for development while production
  publishing fails closed when signing configuration is required but absent.

## M19 Local Runtime Productization

- Move packaged data under the Desktop user-data directory and use SQLite as
  the packaged default.
- Migrate existing file-JSON state explicitly with backup and verification.
- Preflight Docker plus pinned Runtime and Artifact Worker images during setup.
- Provide bounded image build/import recovery instead of failing after a model
  has already generated content.
- Persist service logs and expose restart/recovery diagnostics without leaking
  credentials.

## M20 Artifact Productization Closure

- Migrate legacy `generated-output.*` records to semantic, collision-safe names
  without changing attachment identity or download URLs.
- Repair historical version families so unrelated legacy files are not shown as
  versions of each other.
- Preserve extensions and `_vN` suffixes in compact Workboard rows and expose
  the complete name through accessible text and a tooltip.
- Add Desktop live acceptance for multi-output generation, CJK PDF rendering,
  Preview, Download, Changes, restart persistence, and Workspace publication.

## M21 User Cron And Notifications

- Add Workspace-owned schedules with timezone, recurrence, enabled state,
  bounded next-run calculation, and durable execution history.
- A schedule creates or resumes a normal Task through existing Conversation,
  Autopilot, permission, budget, Worker, and approval boundaries.
- Review First and Assisted never gain silent authority from a schedule.
- Add in-app notifications for schedule results, failures, approvals, and human
  input with read/dismiss state and Inbox integration.
- Do not add email, Slack, Discord, Teams, Telegram, or other external message
  delivery in this milestone.

## Execution Order

M18 must close before M19 changes packaged persistence. M20 follows because its
migration and live acceptance depend on the packaged data boundary. M21 then
uses the stable packaged runtime and notification surface.

## Release Evidence

- `apps/desktop/release/My-Mate-Setup-0.1.0-x64.exe` and
  `apps/desktop/release/SHA256SUMS.txt` are the final local release artifacts.
- Packaged health reports `storage.backend_kind=sqlite`; Control Plane, Gateway,
  and Studio return healthy responses on ports 6372, 6373, and 6374.
- The migration manifest records a complete verified import and a physical
  backup beneath the Desktop user-data `_storage/backups` directory.
- Schedule reads require `workspace.read`; schedule mutations require
  `mission.edit`; notifications require `workspace.read`.
- External messaging and all other explicitly deferred integrations remain out
  of scope.
