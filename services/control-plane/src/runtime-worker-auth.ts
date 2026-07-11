import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, RUNTIME_WORKER_TOKEN } from "./config.js";

let cachedSecret: string | null = null;

function secretPath(): string {
  return path.join(DATA_DIR, "_runtime", "worker-token.key");
}

function getRuntimeWorkerSecret(): string {
  if (RUNTIME_WORKER_TOKEN) {
    return RUNTIME_WORKER_TOKEN;
  }
  if (cachedSecret) {
    return cachedSecret;
  }
  const filePath = secretPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    cachedSecret = fs.readFileSync(filePath, "utf-8").trim();
  } else {
    cachedSecret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(filePath, `${cachedSecret}\n`, { encoding: "utf-8", mode: 0o600 });
  }
  if (!cachedSecret) {
    throw new Error("Runtime worker secret is empty.");
  }
  return cachedSecret;
}

export function deriveRuntimeWorkerToken(workerId: string): string {
  return crypto
    .createHmac("sha256", getRuntimeWorkerSecret())
    .update(workerId)
    .digest("hex");
}
