import type {
  DashboardCostAttributionGroup,
  DashboardSummaryResponse,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

type CostReportGroupBy = "agent" | "model" | "work-package";

function formatMoney(values: Record<string, string> | undefined): string {
  const entries = Object.entries(values || {});
  return entries.length
    ? entries.map(([currency, amount]) => `${currency} ${amount}`).join(", ")
    : "unavailable";
}

function selectedGroups(
  report: DashboardSummaryResponse["observability"]["cost_report"],
  groupBy: CostReportGroupBy,
): readonly DashboardCostAttributionGroup[] {
  if (groupBy === "model") return report.by_provider_model;
  if (groupBy === "work-package") return report.by_work_package;
  return report.by_agent;
}

export async function executeCostReport(
  client: ApiClientLike,
  options: {
    windowHours?: number;
    status?: string;
    groupBy?: CostReportGroupBy;
    limit?: number;
    json?: boolean;
  },
  io: CommandIo,
): Promise<number> {
  try {
    const params = new URLSearchParams({
      window_hours: String(options.windowHours || 24),
      status: options.status || "all",
      correlation_limit: "1",
    });
    const response = await client.get<DashboardSummaryResponse>(
      `/api/dashboard/summary?${params.toString()}`,
    );
    if (options.json) {
      writeJson(io, response.observability.cost_report);
      return 0;
    }

    const report = response.observability.cost_report;
    const coverage = report.coverage;
    const groupBy = options.groupBy || "agent";
    const groups = selectedGroups(report, groupBy).slice(0, Math.max(1, options.limit || 20));
    io.stdout(
      `Cost report | ${response.observability.query.window_hours}h | ${response.observability.query.status} | ${coverage.cost_completeness} ${coverage.costed_jobs}/${coverage.model_jobs} jobs | effective ${formatMoney(report.totals.effective_costs)}`,
    );
    io.stdout(`Grouped by ${groupBy}:`);
    if (!groups.length) {
      io.stdout("No model cost attribution is available.");
      return 0;
    }
    for (const group of groups) {
      io.stdout(
        `${group.label} | jobs=${group.costed_jobs}/${group.model_jobs} | tokens=${group.total_tokens ?? "-"} | cost=${formatMoney(group.effective_costs)} | source=${group.cost_source} | failures=${group.failed_jobs} | retries=${group.retry_attempts}`,
      );
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}
