# My Mate Mobile

React Native / Expo mobile shell for the My Mate control experience.

Current scope:

- home overview
- create run from published templates
- strict validation by default before run creation, with explicit warn override
- template search by name / description / domain
- schema-driven input form:
  - enum segmented options
  - boolean switches
  - number / integer parsing
  - textarea-style multiline inputs
- inbox for approval / human input
- run follow-up view
- run list with status filters:
  - all
  - active
  - waiting
  - done
  - failed
- create success handoff back to the run list with the new run highlighted
- mobile control actions:
  - approve / reject
  - submit human input
  - pause / resume / cancel

## Gateway endpoints used

- `GET /api/mobile/home`
- `GET /api/mobile/inbox`
- `GET /api/mobile/runs`
- `GET /api/mobile/runs/:runId/follow-up`
- `GET /api/templates`
- `POST /api/runs`
- `POST /api/approvals/:approvalId/approve`
- `POST /api/approvals/:approvalId/reject`
- `POST /api/human-inputs/:inputRequestId/submit`
- `POST /api/runs/:runId/actions/pause`
- `POST /api/runs/:runId/actions/resume`
- `POST /api/runs/:runId/actions/cancel`

## API base URL

Set:

`EXPO_PUBLIC_MY_MATE_API_BASE_URL=http://127.0.0.1:4030`

For Android emulator you will usually want:

`EXPO_PUBLIC_MY_MATE_API_BASE_URL=http://10.0.2.2:4030`

The legacy `EXPO_PUBLIC_CONTROL_PLANE_BASE_URL` env var is still accepted for direct control-plane development.

## Scripts

- `npm install`
- `npm run dev`
- `npm run check`
- `npm test`

## Local Android notes

- Android emulator access to the local gateway is expected through:
  - `http://10.0.2.2:4030`
- When using a locally built debug app, Metro should be reachable on:
  - `http://10.0.2.2:8081`
- On this machine, `npm` TLS verification required a project-local fallback:
  - [`.npmrc`](C:/project/my-mate/apps/mobile/.npmrc)
