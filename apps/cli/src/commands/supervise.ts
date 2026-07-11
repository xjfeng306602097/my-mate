import type { SuperviseRunResponse } from "@my-mate/shared-types/control-plane";
import type { ApiClientLike } from "../client.js";
import type { CommandIo } from "../output.js";
import { reportCommandError, writeJson } from "../output.js";

export type SuperviseResponse = SuperviseRunResponse;

export interface SuperviseCommandOptions {
  follow?: boolean;
  cursor?: string;
  interval?: number;
  timeout?: number;
  json?: boolean;
  jsonLines?: boolean;
}

export interface SuperviseOutcome {
  exitCode: number;
  last: SuperviseResponse | null;
}

function renderTick(response: SuperviseResponse, io: CommandIo): void {
  io.stdout(
    `${response.run_id} ${response.status}${response.settled ? " settled" : ""} | jobs=${response.resources.active_jobs} workers=${response.resources.connected_ephemeral_workers} leases=${response.resources.active_leases}`,
  );
  for (const node of response.changed_nodes) {
    io.stdout(`  node ${node.name} [${node.status}]`);
  }
  for (const event of response.deltas.events) {
    io.stdout(`  event #${event.run_sequence ?? "?"} ${event.type}${event.node_run_id ? ` (${event.node_run_id})` : ""}`);
  }
  for (const item of response.deltas.evidence) io.stdout(`  evidence ${item.kind}: ${item.summary}`);
  for (const item of response.deltas.handoffs) io.stdout(`  handoff ${item.handoff_id}: ${item.summary || "recorded"}`);
  for (const item of response.deltas.artifacts) io.stdout(`  artifact ${item.name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeSupervise(
  client: ApiClientLike,
  runId: string,
  options: SuperviseCommandOptions,
  io: CommandIo,
  dependencies: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<SuperviseOutcome> {
  if (options.json && options.jsonLines) {
    io.stderr("Choose either --json or --json-lines.");
    return { exitCode: 2, last: null };
  }
  const now = dependencies.now || Date.now;
  const wait = dependencies.sleep || sleep;
  const startedAt = now();
  let cursor = options.cursor || null;
  let last: SuperviseResponse | null = null;
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.once("SIGINT", onInterrupt);
  try {
    while (true) {
      if (interrupted) return { exitCode: 4, last };
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const response = await client.get<SuperviseResponse>(
        `/api/runs/${encodeURIComponent(runId)}/supervise?${query}`,
      );
      last = response;
      cursor = response.cursor;
      if (options.jsonLines) io.stdout(JSON.stringify(response));
      else if (!options.json) renderTick(response, io);
      if (!options.follow) {
        if (options.json) writeJson(io, response);
        return { exitCode: 0, last };
      }
      if (["completed", "failed", "cancelled"].includes(response.status) && response.settled) {
        if (options.json) writeJson(io, response);
        return { exitCode: 0, last };
      }
      if (options.timeout !== undefined && now() - startedAt >= options.timeout * 1000) {
        io.stderr(`Supervise timed out after ${options.timeout} seconds.`);
        return { exitCode: 4, last };
      }
      const delay = options.interval ?? response.next_poll_after_ms;
      await wait(Math.max(0, delay));
    }
  } catch (error) {
    return { exitCode: reportCommandError(io, error), last };
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }
}
