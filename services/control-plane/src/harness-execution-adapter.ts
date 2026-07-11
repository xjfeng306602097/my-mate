import type { NodeAction, RunAction } from "./control-actions.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import type {
  AdapterDispatchResult,
  DispatchEnvelope,
  ExecutionMaintenanceResult,
  NormalizedExecutionReport,
} from "./types.js";
import { generateEventId } from "./utils.js";

function logHarnessAdapter(kind: string, message: string, context: Record<string, string>): void {
  console.warn(`[${kind}-adapter] ${message}`, context);
}

export class DeferredHarnessExecutionAdapter implements ExecutionAdapter {
  readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }

  enqueueRun(runId: string): void {
    logHarnessAdapter(this.kind, "run queued for deferred harness dispatch.", { runId });
  }

  notifyRunAction(runId: string, action: RunAction): void {
    logHarnessAdapter(this.kind, "run action recorded; harness control is not wired yet.", {
      runId,
      action,
    });
  }

  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void {
    logHarnessAdapter(this.kind, "node action recorded; harness control is not wired yet.", {
      runId,
      nodeRunId,
      action,
    });
  }

  async dispatchNode(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    logHarnessAdapter(this.kind, "dispatch deferred because no worker bridge is configured.", {
      runId: envelope.run_id,
      nodeRunId: envelope.node_run_id,
      runtimeAgentRef: envelope.runtime_agent_ref || "",
    });
    return {
      dispatch_id: `disp_${this.kind.replace(/[^a-z0-9]+/gi, "_")}_${generateEventId()}`,
      openclaw_task_id: null,
      openclaw_session_id: null,
      status: "deferred",
    };
  }

  async handleReport(report: NormalizedExecutionReport): Promise<void> {
    logHarnessAdapter(this.kind, "report reached deferred harness adapter.", {
      runId: report.run_id,
      nodeRunId: report.node_run_id,
      status: report.status,
    });
  }

  async runMaintenance(action: "dispatch_sweep"): Promise<ExecutionMaintenanceResult> {
    return {
      action,
      adapter_kind: this.kind,
      supported: false,
      message: `${this.kind} harness adapter is registered but does not manage external dispatch records yet.`,
      summary: null,
    };
  }
}
