import assert from "node:assert/strict";
import test from "node:test";

import { selectSetupConnection } from "../src/setup-connection-model.js";

const connections = [
  { connection_id: "disabled", status: "disabled", verification: { status: "verified" } },
  { connection_id: "active-failed", status: "active", verification: { status: "failed" } },
  { connection_id: "active-verified", status: "active", verification: { status: "verified" } },
];

test("prefers the explicitly selected active connection", () => {
  assert.equal(selectSetupConnection(connections, "active-failed")?.connection_id, "active-failed");
});

test("falls back to a verified active connection", () => {
  assert.equal(selectSetupConnection(connections)?.connection_id, "active-verified");
});

test("never loads a disabled connection into Setup", () => {
  assert.equal(selectSetupConnection(connections, "disabled")?.connection_id, "active-verified");
  assert.equal(selectSetupConnection([{ connection_id: "disabled", status: "disabled" }]), null);
});
