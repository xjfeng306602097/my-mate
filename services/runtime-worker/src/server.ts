import http from "node:http";
import { runRuntimeWorkerJob } from "./worker-runtime.js";
import { getSupportedHarnesses } from "./harness/factory.js";
import { getRuntimeWorkerBuildInfo } from "./build-info.js";
import type { RuntimeWorkerJob } from "./types.js";

function isRuntimeWorkerJob(value: unknown): value is RuntimeWorkerJob {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as RuntimeWorkerJob).job_id === "string" &&
    typeof (value as RuntimeWorkerJob).run_id === "string" &&
    typeof (value as RuntimeWorkerJob).node_run_id === "string"
  );
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(body)}\n`);
}

export function createRuntimeWorkerServer(): http.Server {
  return http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      writeJson(res, 400, {
        code: "invalid_request",
        message: "Request is invalid.",
      });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      writeJson(res, 200, {
        status: "ok",
        worker_kind: "runtime-worker",
        build: getRuntimeWorkerBuildInfo(),
        supported_harnesses: getSupportedHarnesses(),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/runtime-worker/jobs/run") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on("end", async () => {
        try {
          const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : "{}";
          const body = JSON.parse(raw) as unknown;
          if (!isRuntimeWorkerJob(body)) {
            writeJson(res, 400, {
              code: "invalid_request",
              message: "RuntimeWorkerJob is required.",
            });
            return;
          }
          const result = await runRuntimeWorkerJob(body);
          writeJson(res, 202, {
            worker_id: "runtime-worker-local",
            events: result.events,
          });
        } catch (error) {
          writeJson(res, 500, {
            code: "worker_run_failed",
            message: error instanceof Error ? error.message : "Runtime worker failed.",
          });
        }
      });
      return;
    }

    writeJson(res, 404, {
      code: "not_found",
      message: "Route not found.",
    });
  });
}
