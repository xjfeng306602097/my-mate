import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireDataDirectoryLease } from "../src/data-directory-lease.js";

test("Control Plane refuses to share a live data directory and releases it cleanly", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-mate-data-lease-"));
  const first = acquireDataDirectoryLease(dataDir, 4010);

  try {
    assert.throws(
      () => acquireDataDirectoryLease(dataDir, 4110),
      /MY_MATE_DATA_DIR_IN_USE.*pid=.*port=4010/,
    );
  } finally {
    first.release();
  }

  const second = acquireDataDirectoryLease(dataDir, 4110);
  second.release();
  assert.equal(fs.existsSync(path.join(dataDir, ".control-plane.lock")), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
