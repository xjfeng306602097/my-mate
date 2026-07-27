# My Mate Studio

Desktop orchestrator workbench for My Mate.

Current MVP scope:

- inspect a unified `Dashboard` page for runtime workload, operator backlog,
  waiting hotspots, and recent failures
- boot into a `Mission Workspace` by default when missions exist, with
  `Orchestrator` kept as the dedicated mission-shaping surface
- start a mission from plain language in a chat-first workbench
- review a compact `MissionSpec`, DAG proposal, and subagent assignments before dispatch
- supervise runtime state, interventions, deliverables, and human gates from the execution cockpit
- use a graph-first runtime view with stable DAG layout, compact run controls, node evidence drawer, trace/evaluation tabs, and narrow-screen topology fallback
- list missions and sessions and reopen them from the left rail
- inspect template lineage and create derived or next-version drafts
- archive templates
- inspect, create, edit, and disable agent profiles and skills from the registry
- start a new draft template
- edit template basics
- edit input schema / policy / agent bindings / metadata as JSON
- inspect a form-backed graph canvas skeleton for template DAG structure
- select graph nodes and edges to focus the matching authoring form rows
- compare explicit route revisions and options from a richer history selector
- inspect side-by-side route graph diffs before confirming or revising
- attach local desktop context references by drag/drop or file picker metadata
- browse current mission context files and generated outputs from the workspace
- add / remove / edit DAG nodes
- add / remove / edit DAG edges
- plan from an intent through the API gateway planner endpoints
- generate an editable DAG draft from intent with registry-aware agent / skill recommendations
- copy a planner candidate run plan into an editable unsaved draft
- save a planner candidate run plan directly as a draft template
- copy or save a planner DAG draft as a draft template after human confirmation
- consume structured planner validation details and group warnings before adoption
- save draft templates through the API gateway
- publish draft templates
- local graph validation preview
- manage the Studio bearer token and selected workspace from Settings
- inspect identity, workspace members, role controls, and the verified audit
  chain
- configure advisory/enforced Registry governance, stage protected mutations,
  and independently approve, reject, or apply proposals
- inspect effective model cost and evidence completeness by Agent, model, or
  work package from the unified Dashboard
- review Docker workspace Change Sets in a three-pane visual diff, including
  bounded text lines, binary/oversized metadata, and explicit Apply or Reject
  confirmation from the Inbox

This MVP is intentionally dependency-free. It runs a small Node static server and proxies same-origin `/api/*` requests to the API gateway, avoiding browser CORS setup during local development.

## Run

```bash
npm run dev
```

Default URL:

`http://127.0.0.1:5174`

Default upstream:

`MY_MATE_API_GATEWAY_BASE_URL=http://127.0.0.1:4030`

Studio stores the bearer token and selected workspace in browser local storage.
Its static proxy forwards `Authorization`, `X-My-Mate-Workspace-Id`, and
`X-Request-Id` to API Gateway. Saving a new token, refreshing identity, or
switching workspaces reloads all workspace-scoped data and clears stale tenant
projections.

## Check

```bash
npm run check
```

## Visual Acceptance

Generic Mission Workspace visual check:

```bash
npm run visual:chrome
```

Provider-backed conversation UI regression:

```bash
npm run visual:conversation -- --studio-url http://127.0.0.1:5174
```

This browser acceptance follows the user path from `New task` through the
first assistant reply. It requires a verified model connection and asserts
that the reply exposes Provider/model evidence, does not create a workflow,
does not contain legacy workflow-guidance text, and produces no frontend
errors. The disposable Session is archived after the screenshot and summary
are written under `tmp/conversation-ui-regression/`. Chrome must expose CDP on
`CHROME_CDP_PORT` or port `9223`.

Runtime graph fixture and responsive visual check:

```bash
npm run check:runtime-graph
npm run visual:runtime-graph
```

Runtime Graph includes a Recovery tab for deadline scans, compensation audit,
cleanup attempt status, and frozen-identity Replay of the selected failed node.

## Limits

- Published templates are read-only in this MVP.
- Workflow authoring uses draggable canvas steps, connection handles, a
  selection Inspector, and zoom controls. Live edge previews while dragging
  and marquee selection are not implemented yet.
- Drag/drop context intake stores metadata references only; browser security
  does not expose full local file paths or upload file bytes in this slice.
- The orchestrator workbench still depends on the existing mission/session
  projection and does not yet have a separate evented materializer.
- Planner previews and DAG drafts are deterministic rule-based suggestions; the copied draft still needs human review before saving or publishing.
- Planner adoption is explicitly confirmed in the Studio before copying or saving a planner-generated draft.
- JSON fields are validated locally for parseability; final schema validation is still performed by the control-plane on save/publish.
- Registry edits use the control-plane upsert APIs; disabled records remain visible for audit and can be re-enabled by saving with `active` status.
- In enforced governance mode, protected Agent Profile, Skill, and Template
  lifecycle actions stage a proposal instead of writing directly. Approval and
  apply remain separate actions, and the Registry refreshes only after apply.
