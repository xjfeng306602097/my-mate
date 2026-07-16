import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeWorkerJob } from "../src/runtime-protocol.js";
import type { DispatchEnvelope } from "../src/types.js";

function buildEnvelope(overrides: Partial<DispatchEnvelope> = {}): DispatchEnvelope {
  return {
    run_id: "run-runtime-001",
    node_run_id: "node-run-runtime-001",
    template_id: "template-runtime",
    template_version: 1,
    workspace_id: "workspace-runtime",
    requested_by: "tester",
    intent: "Verify runtime protocol",
    node_id: "node_runtime",
    node_name: "Runtime Node",
    node_type: "agent_task",
    agent_profile: "runtime-agent",
    runtime_agent_ref: "runtime-ref-001",
    agent_runtime: "codex",
    harness_profile: "coding",
    openclaw_agent_id: null,
    allowed_skills: ["coding-agent"],
    allowed_tools: ["read", "write"],
    registry_provenance: {
      agent_profile_requested: "runtime-agent",
      agent_profile_resolved: "runtime-agent",
      agent_profile_status: "active",
      agent_profile_source: "registry",
      runtime_agent_ref_source: "registry",
      openclaw_agent_id_source: "registry",
      skill_bindings: [],
      tool_bindings: [],
    },
    timeout_seconds: 900,
    parallelism_budget: 1,
    retry_policy: {
      max_attempts: 2,
      attempt: 1,
    },
    input_payload: {
      project_slug: "my-mate",
      project_local_repo: "C:/project/my-mate",
      node_config: {
        worker_image: "my-mate-worker:latest",
        container_group: "runtime",
        required_capabilities: ["docker", "workspace"],
        worker_env: {
          FEATURE_FLAG: "enabled",
        },
        resource_limits: {
          cpus: 2,
          memory_mb: 1024,
          pids: 256,
        },
      },
    },
    output_contract: {},
    trace_context: {
      run_id: "run-runtime-001",
      node_run_id: "node-run-runtime-001",
      requested_by: "tester",
    },
    ...overrides,
  };
}

test("runtime worker job maps generic harness fields to docker worker provisioning", () => {
  const job = buildRuntimeWorkerJob(buildEnvelope(), {
    createdAt: "2026-07-09T00:00:00.000Z",
  });

  assert.equal(job.harness.agent_runtime, "codex");
  assert.equal(job.harness.runtime_agent_ref, "runtime-ref-001");
  assert.equal(job.harness.harness_profile, "coding");
  assert.equal(
    job.job_id,
    "run-runtime-001:node-run-runtime-001:attempt-1:dispatch-1",
  );
  assert.equal(job.dispatch_sequence, 1);
  assert.equal(job.provision.target_kind, "docker-worker");
  assert.equal(job.provision.required, true);
  assert.equal(job.provision.image, "my-mate-worker:latest");
  assert.equal(job.provision.container_group, "runtime");
  assert.deepEqual(job.provision.required_capabilities, ["docker", "workspace"]);
  assert.equal(job.provision.env.AGENT_BACKEND, "codex");
  assert.equal(job.provision.env.MY_MATE_RUNTIME_AGENT_REF, "runtime-ref-001");
  assert.equal(job.provision.env.FEATURE_FLAG, "enabled");
  assert.deepEqual(job.provision.resource_limits, {
    cpus: 2,
    memory_mb: 1024,
    pids: 256,
  });
  assert.equal(job.provision.workspace.mode, "shared");
  assert.equal(job.created_at, "2026-07-09T00:00:00.000Z");
});

test("runtime worker job carries an optional verified workspace context snapshot", () => {
  const workspaceContext = {
    schema_version: 1 as const,
    mode: "snapshot" as const,
    source_session_id: "session-runtime",
    created_at: "2026-07-13T10:00:00.000Z",
    manifest_sha256: "a".repeat(64),
    total_size_bytes: 4,
    files: [{
      attachment_id: "attachment-runtime",
      name: "brief.txt",
      relative_path: "brief.txt",
      mime_type: "text/plain",
      size_bytes: 4,
      content_sha256: "b".repeat(64),
      content: "test",
    }],
  };
  const job = buildRuntimeWorkerJob(buildEnvelope(), { workspaceContext });
  assert.equal(job.provision.workspace.context, workspaceContext);
  assert.equal(job.provision.workspace.context?.files[0]?.relative_path, "brief.txt");
});

for (const agentRuntime of ["codex", "claude-sdk", "glm", "kimi"] as const) {
  test(`runtime worker job targets docker worker for ${agentRuntime}`, () => {
    const job = buildRuntimeWorkerJob(
      buildEnvelope({
        agent_runtime: agentRuntime,
        runtime_agent_ref: `${agentRuntime}-runtime`,
        openclaw_agent_id: null,
      }),
    );

    assert.equal(job.harness.agent_runtime, agentRuntime);
    assert.equal(job.provision.target_kind, "docker-worker");
    assert.equal(job.provision.required, true);
  });
}

test("runtime worker job keeps OpenClaw behind external bridge target", () => {
  const job = buildRuntimeWorkerJob(
    buildEnvelope({
      agent_runtime: null,
      harness_profile: null,
      openclaw_agent_id: "legacy-openclaw-agent",
      input_payload: {
        node_config: {},
      },
    }),
  );

  assert.equal(job.harness.agent_runtime, "openclaw");
  assert.equal(job.provision.target_kind, "external-bridge");
  assert.equal(job.provision.required, false);
  assert.equal(job.provision.env.AGENT_BACKEND, "openclaw");
});

test("runtime policy keeps low-risk deterministic work local", () => {
  const job = buildRuntimeWorkerJob(buildEnvelope({
    agent_runtime: "local",
    runtime_agent_ref: null,
    allowed_tools: ["read"],
    input_payload: { node_config: { worker_target_kind: "local" } },
  }));
  assert.equal(job.provision.target_kind, "local");
  assert.equal(job.provision.execution_policy.risk_level, "low");
  assert.equal(job.provision.execution_policy.requires_change_approval, false);
});

test("runtime policy overrides local placement for mutable project access", () => {
  const job = buildRuntimeWorkerJob(buildEnvelope({
    agent_runtime: "local",
    runtime_agent_ref: null,
    allowed_tools: ["read", "write", "shell"],
    input_payload: {
      project_local_repo: "C:/project/my-mate",
      node_config: { worker_target_kind: "local" },
    },
  }));
  assert.equal(job.provision.target_kind, "docker-worker");
  assert.equal(job.provision.execution_policy.risk_level, "high");
  assert.equal(job.provision.execution_policy.workspace_access, "sandbox-write");
  assert.equal(job.provision.execution_policy.requires_change_approval, true);
  assert.match(job.provision.execution_policy.reasons.join(" "), /overridden/u);
});

test("runtime policy stages declared read-only project paths instead of exposing them locally", () => {
  const job = buildRuntimeWorkerJob(buildEnvelope({
    agent_runtime: "local",
    runtime_agent_ref: null,
    allowed_tools: ["read"],
    input_payload: {
      project_local_repo: "C:/project/my-mate",
      node_config: { worker_target_kind: "local" },
    },
  }));
  assert.equal(job.provision.target_kind, "docker-worker");
  assert.equal(job.provision.execution_policy.risk_level, "elevated");
  assert.equal(job.provision.execution_policy.workspace_access, "sandbox-write");
  assert.equal(job.provision.execution_policy.requires_change_approval, true);
});
