import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { RUN_PLANS_DIR } from "../src/config.js";
import { getRunPlan, saveRunPlan } from "../src/run-plan-store.js";
import type { RunPlanRecord } from "../src/types.js";
import { resetTestRoot } from "./helpers.js";

test("legacy RunPlans gain required Harness and Registry fields before recovery saves them", () => {
  resetTestRoot();
  const runId = "run_legacy_recovery";
  const legacy = {
    run_id: runId,
    template_id: "legacy-template",
    template_version: 1,
    workspace_id: "default",
    requested_by: "legacy-test",
    intent: "Recover a legacy run plan",
    inputs: {},
    compiled_nodes: [{
      node_run_id: "nr_legacy",
      node_id: "node_legacy",
      name: "Legacy node",
      type: "agent_task",
      agent_profile: "legacy-agent",
      openclaw_agent_id: "legacy-agent",
      allowed_skills: ["legacy-skill"],
      allowed_tools: ["read"],
      status: "ready",
      retry_policy: { max_attempts: 1, attempt: 0 },
      timeout_seconds: 300,
      parallelism_budget: 1,
      input_payload: {},
      output_contract: {},
      execution_ref: { openclaw_task_id: null, openclaw_session_id: null },
    }],
    edges: [],
    frontier: ["nr_legacy"],
    policy_snapshot: {},
    planner_context: {},
    status: "queued",
    created_at: "2026-06-06T00:00:00.000Z",
  };
  fs.mkdirSync(RUN_PLANS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_PLANS_DIR, `${runId}.json`), JSON.stringify(legacy), "utf-8");

  const normalized = getRunPlan(runId);
  assert.ok(normalized);
  const node = normalized.compiled_nodes[0];
  assert.equal(node.runtime_agent_ref, "legacy-agent");
  assert.equal(node.agent_runtime, null);
  assert.equal(node.harness_profile, null);
  assert.equal(node.approval_kind, null);
  assert.equal(node.human_input_schema, null);
  assert.equal(node.registry_provenance.agent_profile_source, "fallback");
  assert.equal(node.registry_provenance.runtime_agent_ref_source, "fallback");
  assert.equal(node.work_package?.identity_source, "legacy_inferred");

  assert.doesNotThrow(() => saveRunPlan(normalized as RunPlanRecord));
});
