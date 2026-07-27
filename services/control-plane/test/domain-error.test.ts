import assert from "node:assert/strict";
import test from "node:test";
import { LifecycleTransitionError } from "@my-mate/shared-types/domain-lifecycle";
import { DomainError, domainErrorResponse, isDomainError, toDomainError } from "../src/domain-error.js";

test("DomainError serializes stable metadata without exposing its cause", () => {
  const source = new DomainError({
    code: "provider_network_error",
    message: "Connection reset.",
    httpStatus: 503,
    retryable: true,
    severity: "warning",
    remediation: "Retry after backoff.",
    domain: "provider",
    details: { provider_id: "provider-test" },
    cause: new Error("private transport detail"),
  });
  const response = domainErrorResponse(source);
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    code: "provider_network_error",
    message: "Connection reset.",
    retryable: true,
    severity: "warning",
    remediation: "Retry after backoff.",
    domain: "provider",
    details: { provider_id: "provider-test" },
  });
  assert.equal("cause" in response.body, false);
});

test("LifecycleTransitionError maps to a non-retryable conflict with transition details", () => {
  const error = toDomainError(new LifecycleTransitionError("Run", "completed", "running", false));
  assert.equal(isDomainError(error), true);
  assert.equal(error.httpStatus, 409);
  assert.equal(error.code, "invalid_lifecycle_transition");
  assert.deepEqual(error.details, { lifecycle: "Run", from: "completed", to: "running", recovery: false });
});

test("known persistence consistency codes receive stable domain metadata", () => {
  const error = toDomainError(Object.assign(new Error("Statuses differ."), { code: "runtime_aggregate_node_status_mismatch" }));
  assert.equal(error.httpStatus, 409);
  assert.equal(error.retryable, false);
  assert.equal(error.severity, "critical");
  assert.equal(error.domain, "runtime");
});
