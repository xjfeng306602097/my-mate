import type { NodeAction, RunAction } from "./control-actions.js";
import type {
  AdapterDispatchResult,
  DispatchEnvelope,
  ExecutionMaintenanceResult,
  NormalizedExecutionReport,
} from "./types.js";

export interface ExecutionAdapter {
  readonly kind: string;
  enqueueRun(runId: string): void;
  notifyRunAction(runId: string, action: RunAction): void;
  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void;
  dispatchNode(envelope: DispatchEnvelope): Promise<AdapterDispatchResult>;
  handleReport(report: NormalizedExecutionReport): Promise<void>;
  runMaintenance(action: "dispatch_sweep"): Promise<ExecutionMaintenanceResult>;
}
