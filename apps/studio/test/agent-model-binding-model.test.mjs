import assert from "node:assert/strict";
import test from "node:test";

import {
  agentConnectionOptions,
  modelOptionsForConnection,
  preferredAgentBinding,
  validateAgentModelBinding,
} from "../src/agent-model-binding-model.js";

const connections = [
  { connection_id: "alpha", name: "Alpha", status: "active", verification: { status: "verified" }, models: ["alpha-fast", "alpha-pro"], default_model: "alpha-pro" },
  { connection_id: "beta", name: "Beta", status: "active", verification: { status: "verified" }, models: ["beta-one"], default_model: "beta-one" },
  { connection_id: "pending", name: "Pending", status: "active", verification: null, models: ["pending-model"], default_model: "pending-model" },
];

test("Agent model options are scoped to the selected verified Connection", () => {
  assert.deepEqual(agentConnectionOptions(connections).map((item) => item.connection_id), ["alpha", "beta"]);
  assert.deepEqual(modelOptionsForConnection(connections, "alpha").models, ["alpha-pro", "alpha-fast"]);
  assert.deepEqual(modelOptionsForConnection(connections, "beta").models, ["beta-one"]);
});

test("changing Connection resets an incompatible model to that Connection default", () => {
  assert.deepEqual(preferredAgentBinding(connections, "alpha", "alpha-fast"), { connectionId: "alpha", model: "alpha-fast" });
  assert.deepEqual(preferredAgentBinding(connections, "beta", "alpha-fast"), { connectionId: "beta", model: "beta-one" });
});

test("legacy unavailable values remain visible for repair but cannot publish", () => {
  assert.equal(agentConnectionOptions(connections, "pending").some((item) => item.connection_id === "pending"), true);
  assert.equal(modelOptionsForConnection(connections, "alpha", "retired-model").unavailableModel, "retired-model");
  assert.match(validateAgentModelBinding({ connectionId: "pending", model: "pending-model" }, connections)[0], /Verify/);
  assert.match(validateAgentModelBinding({ connectionId: "alpha", model: "retired-model" }, connections)[0], /not available/);
});

test("an Agent may be published unbound for workflow design but partial bindings remain invalid", () => {
  assert.deepEqual(validateAgentModelBinding({ connectionId: "", model: "" }, connections), []);
  assert.match(validateAgentModelBinding({ connectionId: "", model: "alpha-pro" }, connections)[0], /verified Provider Connection/);
  assert.match(validateAgentModelBinding({ connectionId: "alpha", model: "" }, connections)[0], /Select a model/);
});
