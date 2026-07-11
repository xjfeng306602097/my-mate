import type {
  CreateScorecardRequest,
  ScorecardResult as SharedScorecardResult,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type ScorecardResult = SharedScorecardResult;

export interface ScorecardCommandOptions {
  profile?: string;
  allowIncomplete?: boolean;
  json?: boolean;
}

export async function executeScorecard(
  client: ApiClientLike,
  runId: string,
  options: ScorecardCommandOptions,
  io: CommandIo,
): Promise<{ exitCode: number; result: ScorecardResult | null }> {
  try {
    const request: CreateScorecardRequest = {
      profile: options.profile || "pipeline-v1",
      allow_incomplete: options.allowIncomplete === true,
    };
    const result = await client.post<ScorecardResult>(
      `/api/runs/${encodeURIComponent(runId)}/scorecards`,
      request,
    );
    if (options.json) {
      writeJson(io, result);
    } else {
      io.stdout(
        `${result.run_id} scorecard pipeline=${result.pipeline_verdict} contract=${result.contract_verdict} | gate=${result.gate_verdict} | ${result.passed_checks}/${result.total_checks} passed`,
      );
      io.stdout(
        `Errors ${result.hard_error_count} | Warnings ${result.warning_count} | Blind spots ${result.blind_spot_count}`,
      );
      for (const finding of result.findings.filter((item) => !item.passed)) {
        io.stdout(`  [${finding.severity.toUpperCase()}] ${finding.summary}`);
        io.stdout(`    ${finding.detail}`);
      }
    }
    return {
      exitCode:
        result.pipeline_verdict === "pass" && result.gate_verdict !== "reject" ? 0 : 1,
      result,
    };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
