# Shared Types

Shared runtime and API contracts used across My Mate services.

The runtime protocol is compiled from `src/runtime-protocol.ts` and is the
single source of truth for:

- runtime jobs
- worker registration and heartbeats
- job acknowledgements
- worker events and evidence
- worker leases and handoffs
- runtime control messages

Service-to-worker runtime communication must import this package instead of
copying protocol types.

## Generated Control Plane SDK

`src/generated/control-plane.ts` is generated from
`openapi/control-plane.openapi.yaml` with `openapi-typescript`. Do not edit the
generated file directly.

- `npm run generate:control-plane` regenerates committed DTOs and path types.
- `npm run check:generated` fails when the committed output has drifted.
- `@my-mate/shared-types/control-plane` exports common schema aliases and a
  typed `openapi-fetch` client factory.
- `npm test` verifies method, path, request body, headers, and parsed response
  behavior against a fake fetch implementation.

```ts
import { createControlPlaneClient } from "@my-mate/shared-types/control-plane";

const client = createControlPlaneClient({
  baseUrl: "http://127.0.0.1:4030",
  apiKey: process.env.MY_MATE_API_KEY,
});
const { data, error } = await client.POST("/api/diagnostics/doctor", {
  body: { mode: "docker", runtime: "docker-worker" },
});
```

The CLI is the first production consumer of the generated doctor, supervise,
scorecard, evaluation, trace, replay, and replay-plan request/response types.
Runtime WebSocket contracts remain a separate export at
`@my-mate/shared-types/runtime-protocol`.

## Evidence Compatibility

Evidence V2 is additive on the unchanged `my_mate_runtime_v1` WebSocket
transport. New Workers emit `evidence_schema_version=2`, a monotonic per-job
evidence sequence, source/trace metadata, input/output references, and an
explicit usage availability record. The Control Plane continues to accept V1
evidence with missing additive fields and normalizes it as unknown/synthetic.

The shared `HarnessClient` contract streams complete semantic evidence records
through an async emit callback. It does not require token-delta persistence.
`WorkerEvidenceKind` includes `model_turn` so adapters can retain turn
boundaries without treating them as text. Provider-native D2 adapters set
`source.synthetic=false`; deterministic and unrecognized compatibility paths
set it to true and report unavailable usage. Provider-reported and estimated
cost are separate nullable fields by contract.
