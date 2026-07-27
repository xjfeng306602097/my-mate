import assert from "node:assert/strict";
import test from "node:test";
import { assertContractValue, compileContractSchema, expectedContractArtifacts, normalizeContractSchema } from "../src/dag-state-contract.js";

test("DAG contracts accept the shorthand output form used by Agent proposals", () => {
  assert.doesNotThrow(() => assertContractValue({ advantages: "complete" }, { advantages: "string — required summary" }, "Worker output"));
  assert.throws(() => assertContractValue({ advantages: 42 }, { advantages: "string — required summary" }, "Worker output"), (error: unknown) => (error as { code?: string }).code === "agent_contract_validation_failed");
});

test("DAG state schemas allow partial parallel state but require the final contract", () => {
  const schema = { type: "object", properties: { workers: { type: "object" } }, required: ["workers"] };
  assert.doesNotThrow(() => assertContractValue({}, schema, "DAG state", true));
  assert.throws(() => assertContractValue({}, schema, "DAG final state"), (error: unknown) => (error as { code?: string }).code === "agent_contract_validation_failed");
  assert.doesNotThrow(() => assertContractValue({ workers: {} }, schema, "DAG final state"));
});

test("DAG contract schema errors fail during compilation rather than at model time", () => {
  assert.throws(() => compileContractSchema({ type: "not-a-json-schema-type" }, "output_contract"), (error: unknown) => (error as { code?: string }).code === "agent_contract_schema_invalid");
});

test("deliverable metadata is not compiled as an executable output schema", () => {
  const metadata = { expected_artifacts: ["agent-report"], expected_outputs: ["release-notes"] };
  assert.equal(normalizeContractSchema(metadata), null);
  assert.deepEqual(expectedContractArtifacts(metadata), ["agent-report", "release-notes"]);
  assert.doesNotThrow(() => assertContractValue({ summary: "complete" }, metadata, "Worker output"));
});

test("deliverable metadata can coexist with shorthand output fields", () => {
  const contract = { expected_artifacts: ["agent-report"], summary: "string" };
  assert.deepEqual(normalizeContractSchema(contract), {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: true,
  });
  assert.doesNotThrow(() => assertContractValue({ summary: "complete" }, contract, "Worker output"));
  assert.throws(() => assertContractValue({ summary: 42 }, contract, "Worker output"));
});
