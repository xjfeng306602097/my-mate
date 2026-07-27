import assert from "node:assert/strict";
import test from "node:test";
import { runDoctor } from "../src/diagnostics/doctor-service.js";
import { runLiveProviderProbe } from "../src/diagnostics/provider-probe.js";
import type {
  DoctorCommandRunner,
  DoctorRuntimeStatus,
  DoctorWorkerHub,
} from "../src/diagnostics/types.js";
import { RUNTIME_PROTOCOL_VERSION } from "../src/runtime-protocol.js";
import { createJsonStorageBackend } from "../src/storage-backend.js";
import {
  createStubExecutionAdapter,
  postJson,
  resetTestRoot,
  startTestServer,
} from "./helpers.js";

function runtimeStatus(overrides: Partial<DoctorRuntimeStatus> = {}): DoctorRuntimeStatus {
  return {
    dispatcher_kind: "local-runtime-worker",
    legacy_execution_adapter_bridge: false,
    node_provisioner_kind: "local",
    node_provisioner_status: "ready",
    worker_hub_kind: null,
    connected_workers: 0,
    busy_workers: 0,
    stale_workers: 0,
    worker_capacity_limit: 4,
    worker_capacity_active: 0,
    worker_queue_depth: 0,
    worker_queue_limit: 100,
    worker_queue_timeout_ms: 120000,
    worker_cleanup_pending: 0,
    worker_cleanup_failed: 0,
    worker_reconciliation_at: "2026-07-10T02:59:00.000Z",
    worker_reconciliation_status: "healthy",
    worker_reconciliation_discovered: 0,
    worker_reconciliation_orphans: 0,
    worker_reconciliation_removed: 0,
    worker_reconciliation_failures: 0,
    ...overrides,
  };
}

test("doctor quick mode separates deterministic and model readiness", async () => {
  resetTestRoot();
  const report = await runDoctor(
    { mode: "quick", runtime: "local" },
    {
      storage: createJsonStorageBackend("file-json"),
      storageBackendKind: "file-json",
      runtimeStatus: runtimeStatus(),
      executionAdapterKind: "local",
      env: { MY_MATE_HOST_SHELL: "test-host-shell" },
      commandRunner: async (command) => ({
        exitCode: command === "test-host-shell" ? 0 : 1,
        stdout: command === "test-host-shell" ? "host-shell-ready" : "",
        stderr: "",
      }),
      now: () => new Date("2026-07-10T03:00:00.000Z"),
    },
  );

  assert.equal(report.schema_version, 1);
  assert.equal(report.generated_at, "2026-07-10T03:00:00.000Z");
  assert.equal(report.runtime_ready, true);
  assert.equal(report.deterministic_ready, true);
  assert.equal(report.model_ready, false);
  assert.equal(report.model_verified, null);
  assert.equal(
    report.checks.find((check) => check.id === "provider.credential")?.status,
    "skipped",
  );
  assert.equal(report.checks.find((check) => check.id === "host.shell")?.status, "pass");
});

test("doctor docker mode verifies client, daemon, image, mount, and Worker registration", async () => {
  resetTestRoot();
  const calls: string[][] = [];
  const runner: DoctorCommandRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === "info") return { exitCode: 0, stdout: "linux", stderr: "" };
    if (args[0] === "image" && args.at(-1)?.includes("runtime-protocol")) {
      return { exitCode: 0, stdout: RUNTIME_PROTOCOL_VERSION, stderr: "" };
    }
    if (args[0] === "image") return { exitCode: 0, stdout: "sha256:image", stderr: "" };
    if (args[0] === "version") return { exitCode: 0, stdout: "27.0.0", stderr: "" };
    if (args[0] === "run") return { exitCode: 0, stdout: "container-id", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const workerCalls: string[] = [];
  const workerHub: DoctorWorkerHub = {
    expectWorker(input) {
      workerCalls.push(`expect:${input.workerId}`);
    },
    async waitForWorker(workerId) {
      workerCalls.push(`wait:${workerId}`);
      return {};
    },
    releaseWorker(workerId) {
      workerCalls.push(`release:${workerId}`);
    },
  };
  const report = await runDoctor(
    { mode: "docker", runtime: "docker-worker" },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus({
        dispatcher_kind: "docker-runtime-worker",
        node_provisioner_kind: "docker",
        worker_hub_kind: "websocket-worker-hub",
      }),
      executionAdapterKind: "local",
      commandRunner: runner,
      workerHub,
      publicBaseUrl: "http://127.0.0.1:4010",
      env: {},
    },
  );

  assert.equal(report.runtime_ready, true);
  assert.equal(report.deterministic_ready, true);
  assert.equal(report.model_ready, false);
  assert.ok(report.checks.filter((check) => check.status === "fail").length === 0);
  assert.equal(report.checks.find((check) => check.id === "worker.capacity")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "worker.image_identity")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "docker.image_healthcheck")?.status, "pass");
  assert.ok(calls.some((args) => args[0] === "run" && args.includes("--mount")));
  assert.ok(calls.some((args) => args[0] === "run" && args.includes("-d")));
  assert.deepEqual(workerCalls.map((value) => value.split(":")[0]), ["expect", "wait", "release"]);
});

test("doctor warns about a mutable Runtime Worker image without breaking local readiness", async () => {
  resetTestRoot();
  const report = await runDoctor(
    { mode: "quick", runtime: "docker-worker" },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus({
        dispatcher_kind: "docker-runtime-worker",
        node_provisioner_kind: "docker",
        worker_hub_kind: "websocket-worker-hub",
      }),
      executionAdapterKind: "local",
      workerImage: "my-mate-runtime-worker:latest",
      env: {},
    },
  );

  assert.equal(report.runtime_ready, true);
  assert.equal(report.checks.find((check) => check.id === "worker.image_identity")?.status, "warn");
  assert.match(
    report.checks.find((check) => check.id === "worker.image_identity")?.detail || "",
    /kind=latest/,
  );
});

test("doctor docker mode fails deterministic readiness when the image healthcheck is missing", async () => {
  resetTestRoot();
  const runner: DoctorCommandRunner = async (_command, args) => {
    if (args[0] === "info") return { exitCode: 0, stdout: "linux", stderr: "" };
    if (args[0] === "image" && args.at(-1)?.includes("runtime-protocol")) {
      return { exitCode: 0, stdout: RUNTIME_PROTOCOL_VERSION, stderr: "" };
    }
    if (args[0] === "image" && args.at(-1)?.includes("Healthcheck")) {
      return { exitCode: 0, stdout: "null", stderr: "" };
    }
    if (args[0] === "image") return { exitCode: 0, stdout: "sha256:image", stderr: "" };
    if (args[0] === "version") return { exitCode: 0, stdout: "27.0.0", stderr: "" };
    if (args[0] === "run") return { exitCode: 0, stdout: "container-id", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const report = await runDoctor(
    { mode: "docker", runtime: "docker-worker" },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus({
        dispatcher_kind: "docker-runtime-worker",
        node_provisioner_kind: "docker",
        worker_hub_kind: "websocket-worker-hub",
      }),
      executionAdapterKind: "local",
      commandRunner: runner,
      env: {},
    },
  );

  assert.equal(report.deterministic_ready, false);
  assert.equal(report.checks.find((check) => check.id === "docker.image_healthcheck")?.status, "fail");
  assert.match(
    report.checks.find((check) => check.id === "docker.image_healthcheck")?.detail || "",
    /health check is missing/,
  );
});

test("doctor reports failed Runtime Worker compensation as not runtime ready", async () => {
  resetTestRoot();
  const report = await runDoctor(
    { mode: "quick", runtime: "docker-worker" },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus({
        dispatcher_kind: "docker-runtime-worker",
        node_provisioner_kind: "docker",
        worker_hub_kind: "websocket-worker-hub",
        worker_cleanup_failed: 1,
        worker_reconciliation_status: "degraded",
        worker_reconciliation_failures: 1,
      }),
      executionAdapterKind: "local",
      env: {},
    },
  );

  assert.equal(report.runtime_ready, false);
  assert.equal(report.checks.find((check) => check.id === "worker.recovery")?.status, "fail");
  assert.match(
    report.checks.find((check) => check.id === "worker.recovery")?.detail || "",
    /cleanup_failed=1/,
  );
});

test("doctor model mode reports configured separately from live verification without leaking secrets", async () => {
  resetTestRoot();
  const secret = "anthropic-secret-value";
  const report = await runDoctor(
    { mode: "model", runtime: "claude-sdk", model_probe: false },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus(),
      executionAdapterKind: "claude-sdk",
      env: {
        ANTHROPIC_API_KEY: secret,
      },
    },
  );

  assert.equal(report.runtime_ready, true);
  assert.equal(report.model_ready, true);
  assert.equal(report.model_verified, null);
  assert.equal(report.checks.find((check) => check.id === "provider.credential")?.status, "pass");
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("doctor GLM live probe uses the Anthropic-compatible messages endpoint", async () => {
  resetTestRoot();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const report = await runDoctor(
    { mode: "model", runtime: "glm", model_probe: true },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus(),
      executionAdapterKind: "glm",
      env: {
        MY_MATE_GLM_ANTHROPIC_BASE_URL: "https://glm.example.test/anthropic/",
        GLM_API_KEY: "glm-secret-value",
        MY_MATE_GLM_MODEL: "glm-5.2",
      },
      fetchImpl: (async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    },
  );

  assert.equal(report.model_verified, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://glm.example.test/anthropic/v1/messages");
  assert.equal((requests[0]?.init.headers as Record<string, string>)["x-api-key"], "glm-secret-value");
  assert.match(String(requests[0]?.init.body), /"model":"glm-5.2"/);
  assert.equal(JSON.stringify(report).includes("glm-secret-value"), false);
});

test("Kimi live probe accepts an official base URL that already includes v1", async () => {
  const requests: string[] = [];
  await runLiveProviderProbe({
    runtime: "kimi",
    env: {
      KIMI_API_KEY: "kimi-secret-value",
      KIMI_BASE_URL: "https://api.moonshot.cn/v1/",
      MY_MATE_KIMI_MODEL: "kimi-k3",
    },
    fetchImpl: (async (input) => {
      requests.push(String(input));
      return Response.json({ data: [{ id: "kimi-k3" }] });
    }) as typeof fetch,
  });

  assert.deepEqual(requests, ["https://api.moonshot.cn/v1/models"]);
});

test("Kimi live probe supports the Kimi Coding endpoint and validates its model id", async () => {
  const requests: string[] = [];
  await runLiveProviderProbe({
    runtime: "kimi",
    env: {
      MOONSHOT_API_KEY: "kimi-coding-secret-value",
      KIMI_BASE_URL: "https://api.kimi.com/coding/v1",
      MY_MATE_KIMI_MODEL: "k3",
    },
    fetchImpl: (async (input) => {
      requests.push(String(input));
      return Response.json({ data: [{ id: "k3" }, { id: "kimi-for-coding" }] });
    }) as typeof fetch,
  });

  assert.deepEqual(requests, ["https://api.kimi.com/coding/v1/models"]);
});

test("doctor recognizes the GLM Agent Harness and Anthropic-compatible endpoint", async () => {
  resetTestRoot();
  const secret = "glm-secret-value";
  const report = await runDoctor(
    { mode: "model", runtime: "glm", model_probe: false },
    {
      storage: createJsonStorageBackend("file-json"),
      runtimeStatus: runtimeStatus(),
      executionAdapterKind: "glm",
      env: {
        MY_MATE_GLM_ANTHROPIC_BASE_URL: "https://glm.example.test/anthropic",
        GLM_API_KEY: secret,
        MY_MATE_GLM_MODEL: "glm-5.2",
      },
    },
  );

  assert.equal(report.runtime_ready, true);
  assert.equal(report.model_ready, true);
  assert.equal(report.model_verified, null);
  assert.equal(report.checks.find((check) => check.id === "harness.configuration")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "provider.credential")?.status, "pass");
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("doctor API validates mode and exposes the readiness contract", async () => {
  resetTestRoot();
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const invalid = await postJson(`${server.baseUrl}/api/diagnostics/doctor`, {
      mode: "unsafe",
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "invalid_request");

    const quick = await postJson(`${server.baseUrl}/api/diagnostics/doctor`, {
      mode: "quick",
      runtime: "local",
    });
    assert.equal(quick.status, 200);
    assert.equal(quick.body.schema_version, 1);
    assert.equal(typeof quick.body.runtime_ready, "boolean");
    assert.equal(typeof quick.body.deterministic_ready, "boolean");
    assert.equal(quick.body.model_ready, false);
  } finally {
    await server.close();
  }
});

test("doctor resolves a Provider Connection without returning its credential value", async () => {
  resetTestRoot();
  const previous = process.env.GLM_API_KEY;
  const secret = "doctor-provider-connection-secret";
  delete process.env.GLM_API_KEY;
  const server = await startTestServer({ executionAdapter: createStubExecutionAdapter() });
  try {
    const connection = await postJson(`${server.baseUrl}/api/registry/provider-connections`, {
      connection_id: "doctor-glm",
      name: "Doctor GLM",
      agent_runtime: "glm",
      provider: "anthropic-compatible",
      protocol: "anthropic-messages",
      base_url: "https://glm.example.test/anthropic",
      models: ["glm-5.2"],
      default_model: "glm-5.2",
      credential_source: "managed",
      api_key: secret,
    });
    assert.equal(connection.status, 201);

    const report = await postJson(`${server.baseUrl}/api/diagnostics/doctor`, {
      mode: "model",
      runtime: "glm",
      provider_connection_id: "doctor-glm",
      model_probe: false,
    });
    assert.equal(report.status, 200);
    assert.equal(report.body.model_ready, true);
    assert.equal(
      report.body.checks.find((check: { id: string }) => check.id === "provider.connection")?.status,
      "pass",
    );
    assert.equal(
      report.body.checks.find((check: { id: string }) => check.id === "provider.credential")?.status,
      "pass",
    );
    assert.equal(JSON.stringify(report.body).includes(secret), false);

    const missing = await postJson(`${server.baseUrl}/api/diagnostics/doctor`, {
      mode: "model",
      runtime: "glm",
      provider_connection_id: "missing-connection",
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.model_ready, false);
    assert.equal(
      missing.body.checks.find((check: { id: string }) => check.id === "provider.connection")?.status,
      "fail",
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = previous;
  }
});
