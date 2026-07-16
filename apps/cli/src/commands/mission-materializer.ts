import type {
  MissionMaterializerConsistencyReport,
  MissionMaterializerRebuildResponse,
  MissionMaterializerStatus,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

type MissionMaterializerResult =
  | MissionMaterializerStatus
  | MissionMaterializerRebuildResponse
  | MissionMaterializerConsistencyReport;

export async function executeMissionMaterializer(
  client: ApiClientLike,
  sessionId: string,
  options: { rebuild?: boolean; verify?: boolean; json?: boolean },
  io: CommandIo,
): Promise<{ exitCode: number; result: MissionMaterializerResult | null }> {
  try {
    if (options.rebuild && options.verify) {
      throw new Error("Choose either --rebuild or --verify, not both.");
    }
    const base = `/api/missions/${encodeURIComponent(sessionId)}/materializer`;
    const result = options.rebuild
      ? await client.post<MissionMaterializerRebuildResponse>(`${base}/rebuild`, {})
      : options.verify
        ? await client.post<MissionMaterializerConsistencyReport>(`${base}/verify`, {})
        : await client.get<MissionMaterializerStatus>(base);
    if (options.json) writeJson(io, result);
    else {
      io.stdout(
        `${result.session_id} materializer=${"materializer_version" in result ? result.materializer_version : 1} events=${result.event_count} sequence=${result.last_sequence} checkpoint=${result.checkpoint_sequence ?? "none"}`,
      );
      if ("status" in result) {
        io.stdout(
          `consistency=${result.status} differing=${result.differing_sections.join(",") || "none"}`,
        );
      } else {
        io.stdout(`projection=${result.projection_digest || "unknown"}`);
      }
    }
    return {
      exitCode: "status" in result && result.status === "drifted" ? 3 : 0,
      result,
    };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
