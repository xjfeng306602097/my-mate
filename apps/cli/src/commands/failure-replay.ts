import { randomUUID } from "node:crypto";
import type { ExecutionReplayResult } from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export async function executeFailureReplay(
  client: ApiClientLike,
  runId: string,
  nodeRunId: string,
  options: { idempotencyKey?: string; json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: ExecutionReplayResult | null }> {
  try {
    const idempotencyKey = options.idempotencyKey || randomUUID();
    const result = await client.post<ExecutionReplayResult>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeRunId)}/recovery-replays`,
      {},
      { "idempotency-key": idempotencyKey },
    );
    if (options.json) writeJson(io, result);
    else {
      io.stdout(`${result.run_id} node=${result.node_run_id} failure-replay=${result.status}`);
      io.stdout(`source-job=${result.source_job_id} replay-job=${result.replay_job_id || "pending"}`);
      io.stdout(`replay-id=${result.replay_id} identity=${result.identity_digest}`);
    }
    return { exitCode: 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
