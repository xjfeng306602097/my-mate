import type {
  DoctorReport,
  DoctorRequest,
} from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export interface DoctorCommandOptions {
  mode: "quick" | "docker" | "model";
  runtime?: DoctorRequest["runtime"];
  providerConnection?: string;
  modelProbe?: boolean;
  json?: boolean;
}

function renderDoctor(report: DoctorReport, io: CommandIo): void {
  io.stdout(
    `Readiness runtime=${report.runtime_ready} deterministic=${report.deterministic_ready} model=${report.model_ready} verified=${report.model_verified ?? "not-run"}`,
  );
  io.stdout(`Storage ${report.storage_backend} | Dispatcher ${report.runtime_dispatcher}`);
  let category = "";
  for (const check of report.checks) {
    if (check.category !== category) {
      category = check.category;
      io.stdout(`\n${category}`);
    }
    io.stdout(`  [${check.status.toUpperCase()}] ${check.summary} (${check.duration_ms} ms)`);
    if ((check.status === "warn" || check.status === "fail") && check.detail) {
      io.stdout(`    ${check.detail}`);
    }
    if ((check.status === "warn" || check.status === "fail") && check.remediation) {
      io.stdout(`    Remediation: ${check.remediation}`);
    }
  }
}

export async function executeDoctor(
  client: ApiClientLike,
  options: DoctorCommandOptions,
  io: CommandIo,
): Promise<number> {
  try {
    const request: DoctorRequest = {
      mode: options.mode,
      runtime: options.runtime,
      model_probe: options.modelProbe === true,
      provider_connection_id: options.providerConnection,
    };
    const report = await client.post<DoctorReport>("/api/diagnostics/doctor", request);
    if (options.json) writeJson(io, report);
    else renderDoctor(report, io);
    const ready =
      options.mode === "docker"
        ? report.deterministic_ready
        : options.mode === "model"
          ? report.model_ready && (!options.modelProbe || report.model_verified === true)
          : report.runtime_ready;
    return ready ? 0 : 3;
  } catch (error) {
    return reportCommandError(io, error);
  }
}
