import { createHash } from "node:crypto";

const SECRET_KEY = /(^|_)(api_?key|token|secret|password|authorization|cookie|credential)(_|$)/i;

function normalize(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([childKey, item]) => [childKey, normalize(item, childKey)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function canonicalizeForEvidence(value: unknown): unknown {
  return normalize(value);
}

export function evidenceDigest(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeForEvidence(value));
  return `sha256:${createHash("sha256").update(canonical, "utf-8").digest("hex")}`;
}
