import path from "node:path";
import { randomUUID } from "node:crypto";
import { DIAGNOSTICS_DIR } from "../config.js";
import type { JsonStorageBackend } from "../storage-backend.js";

export function runStorageProbe(storage: JsonStorageBackend): void {
  const filePath = path.join(DIAGNOSTICS_DIR, "storage-roundtrip.json");
  const probe = {
    schema_version: 1,
    nonce: randomUUID(),
  };
  storage.ensureDir(DIAGNOSTICS_DIR);
  storage.writeJson(filePath, probe);
  const persisted = storage.readJson<typeof probe>(filePath);
  if (persisted.schema_version !== probe.schema_version || persisted.nonce !== probe.nonce) {
    throw new Error("Storage round-trip returned different data.");
  }
}
