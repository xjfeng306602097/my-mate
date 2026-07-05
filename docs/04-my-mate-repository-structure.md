# My Mate 推荐目录结构

## Goal

Define a repository structure that keeps product concerns separated from execution-kernel integration concerns.

## Proposed Layout

```text
my-mate/
  README.md
  docs/
  openapi/
    control-plane.openapi.yaml
  schemas/
    common/
      pagination.schema.json
      timestamps.schema.json
      enums.schema.json
    agent/
      agent-profile.schema.json
    workflow/
      workflow-template.schema.json
      workflow-node.schema.json
      workflow-edge.schema.json
      run-plan.schema.json
      run-state.schema.json
      node-run.schema.json
      event.schema.json
      artifact.schema.json
      approval.schema.json
      human-input.schema.json
  apps/
    mobile/
      README.md
    studio/
      README.md
  services/
    api-gateway/
      README.md
    control-plane/
      README.md
    execution-adapter/
      README.md
  packages/
    shared-types/
      README.md
```

## Ownership

### `apps/mobile`

Owns:

- mobile UI
- auth session handling
- run list / run detail / intervention UI
- push registration

### `apps/studio`

Owns:

- template list
- DAG editor
- validation UI
- publish workflow

### `services/api-gateway`

Owns:

- client-facing HTTP APIs
- authn/authz
- websocket/SSE fanout
- upload/download proxy

### `services/control-plane`

Owns:

- workflow templates
- run creation
- run state machine
- scheduler
- approval/human input handling
- event emission

### `services/execution-adapter`

Owns:

- dispatch to OpenClaw
- normalize reports back into control-plane events
- maintain task/session correlation

### `schemas`

Owns:

- source-of-truth data contracts
- validation shape for API and persistence

### `openapi`

Owns:

- external API contract
- client/server integration boundary

## Implementation Rule

The first implementation phase should treat:

- `schemas/` as source of truth for data shape
- `openapi/` as source of truth for external API contract

Generated DTOs and client bindings should later derive from them rather than being hand-maintained independently.
