import type { NodeAction, RunAction } from "./control-actions.js";
import type {
  AdapterDispatchResult,
  DispatchEnvelope,
  ExecutionMaintenanceResult,
  NormalizedExecutionReport,
} from "./types.js";

/**
 * Legacy bridge surface kept for cutover adapters.
 *
 * New runtime execution should enter through RuntimeDispatcher.dispatchJob()
 * with a RuntimeWorkerJob. ExecutionAdapter implementations are compatibility
 * backends behind ExecutionAdapterRuntimeDispatcher until HRR-6 removes
 * provider-specific runtime semantics from the mainline.
 */
export interface ExecutionAdapter {
  readonly kind: string;
  enqueueRun(runId: string): void;
  notifyRunAction(runId: string, action: RunAction): void;
  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void;
  dispatchNode(envelope: DispatchEnvelope): Promise<AdapterDispatchResult>;
  handleReport(report: NormalizedExecutionReport): Promise<void>;
  runMaintenance(action: "dispatch_sweep"): Promise<ExecutionMaintenanceResult>;
}
