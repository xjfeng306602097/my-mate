import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRuntimeWorkerReleaseImage,
  defaultRuntimeWorkerImage,
  describeRuntimeWorkerImage,
  resolveRuntimeWorkerImage,
  runtimeWorkerReleaseVersion,
} from "./runtime-worker-release.mjs";

test("Runtime Worker default image follows the repository semantic version", () => {
  assert.equal(defaultRuntimeWorkerImage, `my-mate-runtime-worker:${runtimeWorkerReleaseVersion}`);
  assert.equal(resolveRuntimeWorkerImage({}), defaultRuntimeWorkerImage);
  assert.equal(describeRuntimeWorkerImage(defaultRuntimeWorkerImage).kind, "version_tag");
});

test("explicit Runtime Worker image and repository overrides remain supported", () => {
  assert.equal(
    resolveRuntimeWorkerImage({ MY_MATE_RUNTIME_WORKER_IMAGE: "registry.example/worker@sha256:" + "a".repeat(64) }),
    "registry.example/worker@sha256:" + "a".repeat(64),
  );
  assert.equal(
    resolveRuntimeWorkerImage({ MY_MATE_RUNTIME_WORKER_IMAGE_REPOSITORY: "registry.example/my-mate/worker" }),
    `registry.example/my-mate/worker:${runtimeWorkerReleaseVersion}`,
  );
});

test("release image policy accepts version tags and digests but rejects latest", () => {
  assert.equal(assertRuntimeWorkerReleaseImage("worker:1.2.3").kind, "version_tag");
  assert.equal(
    assertRuntimeWorkerReleaseImage("worker@sha256:" + "b".repeat(64)).kind,
    "digest",
  );
  assert.throws(() => assertRuntimeWorkerReleaseImage("worker:latest"), /not release-ready/);
  assert.equal(
    assertRuntimeWorkerReleaseImage("worker:dev", { allowMutable: true }).kind,
    "custom_tag",
  );
});
