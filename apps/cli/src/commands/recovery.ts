import type {
  RuntimeRecoveryScanResponse,
  RuntimeRecoveryView,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export async function executeRecovery(
  client: ApiClientLike,
  runId: string,
  options: { scan?: boolean; json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: RuntimeRecoveryView | RuntimeRecoveryScanResponse | null }> {
  try {
    const result = options.scan
      ? await client.post<RuntimeRecoveryScanResponse>(`/api/runs/${encodeURIComponent(runId)}/recovery/scan`, {})
      : await client.get<RuntimeRecoveryView>(`/api/runs/${encodeURIComponent(runId)}/recovery`);
    if (options.json) writeJson(io, result);
    else {
      const recovery = "recovery" in result ? result.recovery : result;
      io.stdout(`${recovery.run_id} recovery=${recovery.posture}`);
      io.stdout(`compensations=${recovery.summary.compensations} pending=${recovery.summary.pending_compensations} cleanup-failures=${recovery.summary.cleanup_failures}`);
      io.stdout(`failure-replays=${recovery.summary.execution_replays} active=${recovery.summary.active_replays}`);
      if ("detected" in result) io.stdout(`scan detected=${result.detected} completed=${result.completed} failed=${result.failed}`);
    }
    return { exitCode: 0, result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
