import type { RuntimeWorkerJob } from "../types.js";
import type { LocalHarnessResult } from "./local.js";

export interface OpenClawHarnessResult extends LocalHarnessResult {
  native_events: unknown[];
}

function isHarnessResult(value: unknown): value is LocalHarnessResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { reports?: unknown }).reports),
  );
}

export async function runOpenClawHarness(
  job: RuntimeWorkerJob,
  options?: { signal?: AbortSignal },
): Promise<OpenClawHarnessResult> {
  const bridgeUrl = process.env.MY_MATE_OPENCLAW_WORKER_BRIDGE_URL;
  if (!bridgeUrl) {
    throw new Error("OpenClaw worker bridge URL is not configured.");
  }
  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
    signal: options?.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenClaw worker bridge failed (${response.status}): ${text.slice(-2000)}`);
  }
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!isHarnessResult(body)) {
    throw new Error("OpenClaw worker bridge returned an invalid harness result.");
  }
  const record = body as unknown as Record<string, unknown>;
  return {
    ...body,
    native_events: Array.isArray(record.events)
      ? record.events
      : Array.isArray(record.evidence)
        ? record.evidence
        : [],
  } as OpenClawHarnessResult;
}
