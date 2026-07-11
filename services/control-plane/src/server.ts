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
}

void startControlPlane().catch((error) => {
  console.error("Control Plane startup failed:", error);
  process.exitCode = 1;
});

function shutdown(): void {
  runtime.workerHub?.close();
  runtime.server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
