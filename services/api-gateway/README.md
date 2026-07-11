# API Gateway

Client-facing BFF for My Mate mobile and future Studio clients.

Current scope:

- health check
- Bearer identity and workspace membership resolution
- HMAC-signed internal identity context for the Control Plane
- allowlisted proxy to `services/control-plane`
- mobile-friendly access to:
  - dashboard summary
  - home / inbox / runs
  - templates
  - template lineage / derive / new-version / archive actions
  - agent and skill registry
  - planner template selection / candidate plan preview / DAG draft generation
  - run create/detail/actions
  - canonical run route and cursor-based supervision
  - Doctor readiness diagnostics
  - scorecard and evaluation create/list/detail
  - trace projection, audit replay, replay-plan, and linked rerun
  - approval and human-input actions
  - node retry / skip actions
  - identity, workspace membership, and audit APIs

Current planner/run-create path semantics:

- planner preview endpoints surface structured validation warnings before persistence
- `POST /api/runs` defaults to strict validation when `validation_mode` is omitted
- clients must explicitly send `validation_mode: "warn"` after user confirmation to create a run with known warnings

The gateway intentionally does not expose internal control-plane endpoints such as OpenClaw callbacks.

## P0 Operator API

The Gateway allowlist exposes the P0 operator loop used by `@my-mate/cli`:

- `POST /api/diagnostics/doctor`
- `GET /api/runs/:runId/route`
- `GET /api/runs/:runId/supervise`
- `POST /api/runs/:runId/scorecards`
- `GET /api/runs/:runId/scorecards`
- `GET /api/runs/:runId/scorecards/:scorecardId`
- `POST /api/runs/:runId/evaluations`
- `GET /api/runs/:runId/evaluations`
- `GET /api/runs/:runId/evaluations/:evaluationId`
- `GET /api/runs/:runId/trace`
- `POST /api/runs/:runId/replays`
- `GET /api/runs/:runId/replays/:replayId`
- `POST /api/runs/:runId/replay-plans`
- `GET /api/runs/:runId/replay-plans/:replayPlanId`
- `POST /api/runs/:runId/reruns`

The CLI always calls these Gateway routes. It does not connect directly to the
Control Plane and does not independently schedule work or calculate verdicts.
The Gateway forwards `Idempotency-Key` only for the allowlisted linked-rerun
request path.

## Env Vars

- `PORT=4030`
- `MY_MATE_CONTROL_PLANE_BASE_URL=http://127.0.0.1:4010`
- `MY_MATE_API_GATEWAY_API_KEY=...`
- `MY_MATE_API_GATEWAY_IDENTITIES_JSON=[...]`
- `MY_MATE_INTERNAL_AUTH_SECRET=...`
- `MY_MATE_API_GATEWAY_REQUEST_TIMEOUT_MS=30000`

`MY_MATE_API_GATEWAY_IDENTITIES_JSON` is an array of token, principal, and
membership objects. Configured identities require `MY_MATE_INTERNAL_AUTH_SECRET`.
The same secret must be set on the Control Plane and must never be given to
clients.

Example identity:

```json
[
  {
    "token": "owner-token",
    "principal": {
      "principal_id": "owner-user",
      "display_name": "Workspace Owner",
      "principal_type": "user"
    },
    "memberships": [
      { "workspace_id": "alpha", "workspace_name": "Alpha", "role": "owner" }
    ]
  }
]
```

Clients select a membership with `X-My-Mate-Workspace-Id`. A foreign workspace
returns `403`. `MY_MATE_API_GATEWAY_API_KEY` remains a legacy single-key
development path for the `default` workspace. If neither identity mechanism is
configured, auth is disabled only for local development.

## Run

```bash
npm install
npm run dev
```

## Check

```bash
npm run check
npm test
```
