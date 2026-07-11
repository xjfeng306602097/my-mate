import assert from "node:assert/strict";
import test from "node:test";
import { createControlPlaneClient } from "../dist/control-plane.js";

test("generated Control Plane client sends typed path, body, and authentication", async () => {
  const observed = [];
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    observed.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      requestId: request.headers.get("x-request-id"),
      workspaceId: request.headers.get("x-my-mate-workspace-id"),
      body: await request.clone().json(),
    });
    return new Response(JSON.stringify({
      schema_version: 1,
      report_id: "doctor-test",
      generated_at: "2026-07-11T00:00:00.000Z",
      runtime_ready: true,
      deterministic_ready: true,
      model_ready: false,
      model_verified: null,
      storage_backend: "file-json",
      runtime_dispatcher: "docker-runtime-worker",
      checks: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createControlPlaneClient({
    baseUrl: "http://127.0.0.1:4030/",
    apiKey: "sdk-secret",
    workspaceId: "workspace-sdk",
    fetch: fetchImpl,
    headers: { "x-request-id": "sdk-test" },
  });

  const { data, error, response } = await client.POST("/api/diagnostics/doctor", {
    body: { mode: "docker", runtime: "docker-worker", model_probe: false },
  });

  assert.equal(response.status, 200);
  assert.equal(error, undefined);
  assert.equal(data?.report_id, "doctor-test");
  assert.deepEqual(observed, [{
    method: "POST",
    url: "http://127.0.0.1:4030/api/diagnostics/doctor",
    authorization: "Bearer sdk-secret",
    requestId: "sdk-test",
    workspaceId: "workspace-sdk",
    body: { mode: "docker", runtime: "docker-worker", model_probe: false },
  }]);
});
