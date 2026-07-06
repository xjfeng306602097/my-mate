# My Mate Studio

Desktop orchestrator workbench for My Mate.

Current MVP scope:

- boot into a `Mission Workspace` by default when missions exist, with
  `Orchestrator` kept as the dedicated mission-shaping surface
- start a mission from plain language in a chat-first workbench
- review a compact `MissionSpec`, DAG proposal, and subagent assignments before dispatch
- supervise runtime state, interventions, deliverables, and human gates from the execution cockpit
- list missions and sessions and reopen them from the left rail
- inspect template lineage and create derived or next-version drafts
- archive templates
- inspect, create, edit, and disable agent profiles and skills from the registry
- start a new draft template
- edit template basics
- edit input schema / policy / agent bindings / metadata as JSON
- inspect a form-backed graph canvas skeleton for template DAG structure
- select graph nodes and edges to focus the matching authoring form rows
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

This MVP is intentionally dependency-free. It runs a small Node static server and proxies same-origin `/api/*` requests to the API gateway, avoiding browser CORS setup during local development.

## Run

```bash
npm run dev
```

Default URL:

`http://127.0.0.1:5174`

Default upstream:

`MY_MATE_API_GATEWAY_BASE_URL=http://127.0.0.1:4030`

## Check

```bash
npm run check
```

## Visual Acceptance

Generic Mission Workspace visual check:

```bash
npm run visual:chrome
```

OpenClaw E2E projection visual check:

```bash
npm run visual:openclaw
```

`visual:openclaw` reads the latest
`tmp/main-openclaw-proposal-e2e/*/summary.json` by default and captures
screenshots plus `visual-summary.json` under `tmp/openclaw-visual-acceptance/`.
Pass `-- --summary <path>` to target a specific E2E run. Chrome must be running
with remote debugging on `CHROME_CDP_PORT` or port `9223`. Pass
`-- --close-existing-studio-tabs` when stale local Studio tabs make CDP
navigation unstable.

## Limits

- Published templates are read-only in this MVP.
- Graph editing now has a form-backed canvas skeleton, but drag-and-drop canvas
  editing is not implemented yet.
- The orchestrator workbench still depends on the existing mission/session
  projection and does not yet have a separate evented materializer.
- Planner previews and DAG drafts are deterministic rule-based suggestions; the copied draft still needs human review before saving or publishing.
- Planner adoption is explicitly confirmed in the Studio before copying or saving a planner-generated draft.
- JSON fields are validated locally for parseability; final schema validation is still performed by the control-plane on save/publish.
- Registry edits use the control-plane upsert APIs; disabled records remain visible for audit and can be re-enabled by saving with `active` status.
