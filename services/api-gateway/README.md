# API Gateway

Client-facing BFF for My Mate mobile and future Studio clients.

Current scope:

- health check
- optional Bearer token auth
- allowlisted proxy to `services/control-plane`
- mobile-friendly access to:
  - home / inbox / runs
  - templates
  - template lineage / derive / new-version / archive actions
  - agent and skill registry
  - planner template selection / candidate plan preview / DAG draft generation
  - run create/detail/actions
  - approval and human-input actions
  - node retry / skip actions

Current planner/run-create path semantics:

- planner preview endpoints surface structured validation warnings before persistence
- `POST /api/runs` defaults to strict validation when `validation_mode` is omitted
- clients must explicitly send `validation_mode: "warn"` after user confirmation to create a run with known warnings

The gateway intentionally does not expose internal control-plane endpoints such as OpenClaw callbacks.

## Env Vars

- `PORT=4030`
- `MY_MATE_CONTROL_PLANE_BASE_URL=http://127.0.0.1:4010`
- `MY_MATE_API_GATEWAY_API_KEY=...`
- `MY_MATE_API_GATEWAY_REQUEST_TIMEOUT_MS=30000`

If `MY_MATE_API_GATEWAY_API_KEY` is empty, auth is disabled for local development.

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
