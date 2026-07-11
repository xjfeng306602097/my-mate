import http from "node:http";
import { PORT, PUBLIC_BASE_URL } from "./config.js";
import { RUNTIME_DISPATCHER_KIND } from "./config.js";
import { createApp } from "./app.js";
import { getExecutionAdapter } from "./execution-adapter-factory.js";
import { DockerWorkerProvisioner } from "./node-provisioner.js";
import { RuntimeWorkerHub } from "./runtime-worker-hub.js";
import { WorkerRuntimeDispatcher } from "./worker-runtime-dispatcher.js";
import type { RuntimeEngine } from "./runtime/runtime-engine.js";
import { recoverRuntimeState } from "./runtime/runtime-recovery.js";
import { recoverPendingEvaluations } from "./evaluation/evaluation-engine.js";
import {
  resumeRequestedFailureReplays,
  scanRuntimeTimeouts,
} from "./runtime/runtime-recovery-service.js";

export function createControlPlaneRuntimeServer() {
  const executionAdapter = getExecutionAdapter();
  const workerMode = ["docker", "docker-worker", "runtime-worker", "worker"].includes(
    RUNTIME_DISPATCHER_KIND,
  );
  const workerHub = workerMode ? new RuntimeWorkerHub() : null;
  const provisioner = workerHub ? new DockerWorkerProvisioner(workerHub) : null;
  const dispatcher =
    workerHub && provisioner
      ? new WorkerRuntimeDispatcher(workerHub, provisioner, executionAdapter)
      : undefined;
  let runtimeEngine: RuntimeEngine | null = null;
  const app = createApp({
    executionAdapter,
    dispatcher,
    provisioner,
    doctor: {
      workerHub,
      publicBaseUrl: PUBLIC_BASE_URL,
    },
    onRuntimeEngine: (engine) => {
      runtimeEngine = engine;
    },
  });
  const server = http.createServer(app);
  workerHub?.attach(server);
  return {
    app,
    server,
    workerHub,
    provisioner,
    dispatcher,
    runtimeEngine,
  };
}

const runtime = createControlPlaneRuntimeServer();
let recoveryWatchdog: NodeJS.Timeout | null = null;
let recoveryScanRunning = false;

async function startControlPlane(): Promise<void> {
  const evaluationRecovery = recoverPendingEvaluations();
  if (evaluationRecovery.queued || evaluationRecovery.recovered || evaluationRecovery.failed) {
    console.log(
      `Evaluation recovery: ${evaluationRecovery.queued} queued, ${evaluationRecovery.recovered} recovered, ${evaluationRecovery.failed} failed.`,
    );
  }
  if (runtime.runtimeEngine) {
    try {
      const summary = await recoverRuntimeState({
        engine: runtime.runtimeEngine,
        provisioner: runtime.provisioner,
      });
      if (summary.scanned_runs > 0 || summary.reconciliation) {
        console.log(
          `Runtime recovery: ${summary.recovered_runs.length} recovered, ${summary.redispatched_runs.length} redispatched, ${summary.cleanup_failed_leases.length} cleanup failures.`,
        );
      }
      const timeoutRecovery = await scanRuntimeTimeouts({
        engine: runtime.runtimeEngine,
        dispatcher: runtime.dispatcher,
        provisioner: runtime.provisioner,
      });
      if (timeoutRecovery.detected > 0) {
        console.log(
          `Timeout compensation: ${timeoutRecovery.completed} completed, ${timeoutRecovery.failed} failed.`,
        );
      }
      const replayRecovery = await resumeRequestedFailureReplays({ engine: runtime.runtimeEngine });
      if (replayRecovery.resumed.length || replayRecovery.failed.length) {
        console.log(
          `Failure replay recovery: ${replayRecovery.resumed.length} resumed, ${replayRecovery.failed.length} failed.`,
        );
      }
    } catch (error) {
      console.error("Runtime recovery failed:", error);
    }
  }
  runtime.server.listen(PORT, () => {
    console.log(`My Mate control-plane listening on http://localhost:${PORT}`);
    console.log(
      `Runtime dispatcher: ${runtime.dispatcher?.kind || "legacy-execution-adapter"}`,
    );
  });
  if (runtime.runtimeEngine) {
    const engine = runtime.runtimeEngine;
    const intervalMs = Math.max(250, Number(process.env.MY_MATE_RECOVERY_SCAN_INTERVAL_MS || 1000));
    recoveryWatchdog = setInterval(() => {
      if (recoveryScanRunning) return;
      recoveryScanRunning = true;
      void scanRuntimeTimeouts({
        engine,
        dispatcher: runtime.dispatcher,
        provisioner: runtime.provisioner,
      })
        .catch((error) => console.error("Runtime timeout scan failed:", error))
        .finally(() => {
          recoveryScanRunning = false;
        });
    }, intervalMs);
    recoveryWatchdog.unref();
  }
}

void startControlPlane().catch((error) => {
  console.error("Control Plane startup failed:", error);
  process.exitCode = 1;
});

function shutdown(): void {
  if (recoveryWatchdog) clearInterval(recoveryWatchdog);
  runtime.workerHub?.close();
  runtime.server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
