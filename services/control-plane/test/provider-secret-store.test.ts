import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROVIDER_SECRETS_DIR } from "../src/config.js";
import {
  getManagedProviderCredential,
  hasManagedProviderCredential,
  setManagedProviderCredential,
} from "../src/provider-secret-store.js";
import { resetTestRoot } from "./helpers.js";

test("managed Provider credentials are encrypted at rest and never serialized as plaintext", () => {
  resetTestRoot();
  const previousKey = process.env.MY_MATE_PROVIDER_SECRET_KEY;
  process.env.MY_MATE_PROVIDER_SECRET_KEY = "provider-secret-test-master-key";
  const secret = "managed-provider-secret-value";
  try {
    setManagedProviderCredential({
      connectionId: "managed-test",
      workspaceId: "default",
      apiKey: secret,
    });

    const stored = fs.readFileSync(path.join(PROVIDER_SECRETS_DIR, "managed-test.json"), "utf8");
    assert.equal(stored.includes(secret), false);
    assert.match(stored, /"algorithm": "aes-256-gcm"/);
    assert.equal(hasManagedProviderCredential("managed-test"), true);
    assert.equal(getManagedProviderCredential("managed-test"), secret);
  } finally {
    if (previousKey === undefined) delete process.env.MY_MATE_PROVIDER_SECRET_KEY;
    else process.env.MY_MATE_PROVIDER_SECRET_KEY = previousKey;
  }
});
