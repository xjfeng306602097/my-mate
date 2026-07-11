import type {
  CreateReplayPlanRequest,
  ReplayPlanResult as SharedReplayPlanResult,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type ReplayPlanResult = SharedReplayPlanResult;

export async function executeReplayPlan(
  client: ApiClientLike,
  runId: string,
  options: { scorecard?: string; evaluation?: string; json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: ReplayPlanResult | null }> {
  try {
    const request: CreateReplayPlanRequest = {
      scorecard_id: options.scorecard || undefined,
      evaluation_id: options.evaluation || undefined,
    };
    const result = await client.post<ReplayPlanResult>(
      `/api/runs/${encodeURIComponent(runId)}/replay-plans`,
      request,
    );
    if (options.json) writeJson(io, result);
    else {
      io.stdout(`${result.run_id} replay-plan ${result.replay_plan_id}`);
      io.stdout(result.summary);
      for (const item of result.recommendations) {
        io.stdout(`  [${item.priority}/${item.category}] ${item.summary}`);
        io.stdout(`    target=${item.change_target} | ${item.rationale}`);
      }
    }
    return { exitCode: 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
