import { randomUUID } from "node:crypto";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";
import { parseInputs } from "./run.js";

interface RerunResult {
  run_id: string;
  status: string;
  source_run_id: string;
  rerun_reason: string;
  rerun_idempotency_key: string | null;
  route: { route_id: string; source_kind: string };
}

export async function executeRerun(
  client: ApiClientLike,
  runId: string,
  options: { reason: string; input?: string[]; idempotencyKey?: string; json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: RerunResult | null }> {
  try {
    const idempotencyKey = options.idempotencyKey || randomUUID();
    const result = await client.post<RerunResult>(
      `/api/runs/${encodeURIComponent(runId)}/reruns`,
      { reason: options.reason, input_overrides: parseInputs(options.input) },
      { "idempotency-key": idempotencyKey },
    );
    if (options.json) writeJson(io, result);
    else {
      io.stdout(`Created ${result.run_id} [${result.status}] from ${result.source_run_id}`);
      io.stdout(`route=${result.route.route_id} source=${result.route.source_kind} idempotency-key=${result.rerun_idempotency_key || idempotencyKey}`);
    }
    return { exitCode: 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
