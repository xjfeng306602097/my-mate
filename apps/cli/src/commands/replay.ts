import type { ReplayResult as SharedReplayResult } from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type ReplayResult = SharedReplayResult;

export async function executeReplay(
  client: ApiClientLike,
  runId: string,
  options: { json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: ReplayResult | null }> {
  try {
    const result = await client.post<ReplayResult>(`/api/runs/${encodeURIComponent(runId)}/replays`, {});
    if (options.json) writeJson(io, result);
    else {
      io.stdout(`${result.run_id} replay=${result.verification} completeness=${result.event_completeness} events=${result.processed_events}`);
      io.stdout(`Differences ${result.projection_differences.length} | Missing references ${result.missing_references.length}`);
      for (const item of result.projection_differences) {
        io.stdout(`  [${item.severity}] ${item.record_id}.${item.field}: ${item.summary}`);
      }
    }
    return { exitCode: result.verification === "fail" ? 1 : 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
