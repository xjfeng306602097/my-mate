import type {
  CreateEvaluationRequest,
  EvaluationResult as SharedEvaluationResult,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type EvaluationResult = SharedEvaluationResult;

export interface EvaluationCommandOptions {
  evaluator?: string;
  allowIncomplete?: boolean;
  requireQuality?: boolean;
  interval?: number;
  timeout?: number;
  json?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exitCode(result: EvaluationResult, requireQuality: boolean): number {
  if (result.status === "failed" || result.gate_verdict === "reject") return 1;
  if (result.pipeline_verdict !== "pass") return 1;
  if (!["pass", "not_applicable"].includes(result.contract_verdict)) return 1;
  if (["fail", "error"].includes(result.quality_verdict)) return 1;
  if (requireQuality && result.quality_verdict === "not_evaluated") return 1;
  return 0;
}

function render(result: EvaluationResult, io: CommandIo): void {
  io.stdout(`${result.run_id} evaluation ${result.status} | evaluator=${result.evaluator.id}`);
  io.stdout(
    `pipeline=${result.pipeline_verdict} contract=${result.contract_verdict} evidence=${result.evidence_verdict} usage=${result.usage_verdict} quality=${result.quality_verdict} gate=${result.gate_verdict}`,
  );
  for (const finding of result.findings.filter((item) => !item.passed)) {
    io.stdout(`  [${finding.dimension}/${finding.severity}] ${finding.summary}`);
    if (finding.detail) io.stdout(`    ${finding.detail}`);
  }
  if (result.error) io.stdout(`  evaluator error: ${result.error}`);
}

export async function executeEvaluation(
  client: ApiClientLike,
  runId: string,
  options: EvaluationCommandOptions,
  io: CommandIo,
  dependencies: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<{ exitCode: number; result: EvaluationResult | null }> {
  const wait = dependencies.sleep || sleep;
  const now = dependencies.now || Date.now;
  const startedAt = now();
  try {
    const request: CreateEvaluationRequest = {
      evaluator: options.evaluator || "none",
      allow_incomplete: options.allowIncomplete === true,
    };
    let result = await client.post<EvaluationResult>(
      `/api/runs/${encodeURIComponent(runId)}/evaluations`,
      request,
    );
    while (["queued", "running"].includes(result.status)) {
      if (options.timeout !== undefined && now() - startedAt >= options.timeout * 1000) {
        io.stderr(`Evaluation timed out after ${options.timeout} seconds.`);
        return { exitCode: 4, result };
      }
      await wait(Math.max(0, options.interval ?? 500));
      result = await client.get<EvaluationResult>(
        `/api/runs/${encodeURIComponent(runId)}/evaluations/${encodeURIComponent(result.evaluation_id)}`,
      );
    }
    if (options.json) writeJson(io, result);
    else render(result, io);
    return { exitCode: exitCode(result, options.requireQuality === true), result };
  } catch (error) {
    return { exitCode: reportCommandError(io, error), result: null };
  }
}
