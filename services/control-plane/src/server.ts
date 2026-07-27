import http from "node:http";
import { DATA_DIR, PORT, PUBLIC_BASE_URL } from "./config.js";
import { RUNTIME_DISPATCHER_KIND } from "./config.js";
import { acquireDataDirectoryLease } from "./data-directory-lease.js";
import { createApp } from "./app.js";
import { ConversationWebSocketHub } from "./conversation-websocket.js";
import { getExecutionAdapter } from "./execution-adapter-factory.js";
import { DockerWorkerProvisioner } from "./node-provisioner.js";
import { RuntimeWorkerHub } from "./runtime-worker-hub.js";
import { WorkerRuntimeDispatcher } from "./worker-runtime-dispatcher.js";
import { initializeCapabilityPluginHost } from "./plugin-host.js";
import { getMcpHost } from "./mcp-host.js";
import type { RuntimeEngine } from "./runtime/runtime-engine.js";
import { recoverRuntimeState } from "./runtime/runtime-recovery.js";
import { recoverPendingEvaluations } from "./evaluation/evaluation-engine.js";
import {
  resumeRequestedFailureReplays,
  scanRuntimeTimeouts,
} from "./runtime/runtime-recovery-service.js";
import { runMemoryMaintenanceSweep } from "./memory-lifecycle.js";

export function createControlPlaneRuntimeServer() {
  initializeCapabilityPluginHost();
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
    productIntelligenceWatchdog: true,
  });
  const server = http.createServer(app);
  workerHub?.attach(server);
  const conversationHub = new ConversationWebSocketHub({
    security: app.locals.conversationSecurity,
    turnHandler: app.locals.streamConversationTurn,
  });
  conversationHub.attach(server);
  return {
    app,
    server,
    workerHub,
    provisioner,
    dispatcher,
    runtimeEngine,
    conversationHub,
  };
}

const dataDirectoryLease = acquireDataDirectoryLease(DATA_DIR, PORT);
let runtime: ReturnType<typeof createControlPlaneRuntimeServer>;
try {
  runtime = createControlPlaneRuntimeServer();
} catch (error) {
  dataDirectoryLease.release();
  throw error;
}
let recoveryWatchdog: NodeJS.Timeout | null = null;
let recoveryScanRunning = false;
let memoryMaintenanceWatchdog: NodeJS.Timeout | null = null;
let memoryMaintenanceRunning = false;
let userScheduleWatchdog: NodeJS.Timeout | null = null;
let userScheduleScanRunning = false;

async function startControlPlane(): Promise<void> {
  await getMcpHost().initialize();
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
    void runtime.app.locals.recoverConversationCheckpoints?.().then((summary: {
      recovered?: number;
      results?: unknown[];
    }) => {
      if (summary?.recovered) {
        console.log(`Conversation recovery: ${summary.recovered} interrupted checkpoint(s) inspected.`);
      }
    }).catch((error: unknown) => console.error("Conversation checkpoint recovery failed:", error));
    void runtime.app.locals.recoverAgentDags?.().then((summary: {
      recovered?: number;
      resumed?: string[];
      deferred?: string[];
    }) => {
      if (summary?.recovered) {
        console.log(`Agent DAG recovery: ${summary.resumed?.length || 0} resumed, ${summary.deferred?.length || 0} waiting for human input.`);
      }
    }).catch((error: unknown) => console.error("Agent DAG recovery failed:", error));
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
  memoryMaintenanceWatchdog = setInterval(() => {
    if (memoryMaintenanceRunning) return;
    memoryMaintenanceRunning = true;
    try {
      runMemoryMaintenanceSweep({ dueOnly: true });
    } catch (error) {
      console.error("Memory maintenance failed:", error);
    } finally {
      memoryMaintenanceRunning = false;
    }
  }, 60_000);
  memoryMaintenanceWatchdog.unref();
  const runUserScheduleScan = () => {
    if (userScheduleScanRunning) return;
    userScheduleScanRunning = true;
    void runtime.app.locals.runDueUserSchedules?.(10)
      .catch((error: unknown) => console.error("User schedule scan failed:", error))
      .finally(() => { userScheduleScanRunning = false; });
  };
  runUserScheduleScan();
  userScheduleWatchdog = setInterval(runUserScheduleScan, 15_000);
  userScheduleWatchdog.unref();
}

void startControlPlane().catch((error) => {
  dataDirectoryLease.release();
  console.error("Control Plane startup failed:", error);
  process.exitCode = 1;
});

let shutdownStarted = false;
async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (recoveryWatchdog) clearInterval(recoveryWatchdog);
  if (memoryMaintenanceWatchdog) clearInterval(memoryMaintenanceWatchdog);
  if (userScheduleWatchdog) clearInterval(userScheduleWatchdog);
  if (runtime.app.locals.productIntelligenceWatchdog) {
    clearInterval(runtime.app.locals.productIntelligenceWatchdog);
  }
  await getMcpHost().shutdown();
  runtime.workerHub?.close();
  runtime.conversationHub.close();
  runtime.server.close(() => {
    dataDirectoryLease.release();
    process.exit(0);
  });
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
process.once("exit", () => dataDirectoryLease.release());
