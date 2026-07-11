import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";
import { executeScorecard } from "./scorecard.js";
import { executeSupervise } from "./supervise.js";

interface CreatedRun {
  run_id: string;
  status: string;
  route?: { route_id: string };
}

export interface RunCommandOptions {
  templateId: string;
  intent: string;
  input?: string[];
  validationMode?: "warn" | "strict" | "bypass";
  follow?: boolean;
  scorecard?: boolean;
  timeout?: number;
  json?: boolean;
}

export function parseInputs(values: string[] = []): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const entry of values) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid --input "${entry}"; expected key=value.`);
    const key = entry.slice(0, separator).trim();
    const raw = entry.slice(separator + 1);
    if (!key) throw new Error(`Invalid --input "${entry}"; key is empty.`);
    try {
      inputs[key] = JSON.parse(raw) as unknown;
    } catch {
      inputs[key] = raw;
    }
  }
  return inputs;
}

export async function executeRun(
  client: ApiClientLike,
  options: RunCommandOptions,
  io: CommandIo,
): Promise<number> {
  if (options.scorecard && !options.follow) {
    io.stderr("--scorecard requires --follow so the run can reach a settled terminal state.");
    return 2;
  }
  try {
    const created = await client.post<CreatedRun>("/api/runs", {
      intent: options.intent,
      template_id: options.templateId,
      inputs: parseInputs(options.input),
      validation_mode: options.validationMode || "warn",
    });
    if (options.json && !options.follow) writeJson(io, created);
    else if (!options.json) {
      io.stdout(`Created ${created.run_id} [${created.status}]${created.route ? ` route=${created.route.route_id}` : ""}`);
    }
    if (!options.follow) return 0;
    const supervised = await executeSupervise(
      client,
      created.run_id,
      { follow: true, timeout: options.timeout, json: options.json },
      io,
    );
    if (supervised.exitCode !== 0) return supervised.exitCode;
    if (supervised.last?.status !== "completed") return 1;
    if (options.scorecard) {
      return (await executeScorecard(client, created.run_id, { json: options.json }, io)).exitCode;
    }
    return 0;
  } catch (error) {
    return reportCommandError(io, error);
  }
}
