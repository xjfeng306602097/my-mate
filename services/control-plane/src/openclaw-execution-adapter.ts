import type { NodeAction, RunAction } from "./control-actions.js";
import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  buildOpenClawBridgeControlRequest,
  buildOpenClawBridgeDispatchRequest,
} from "./adapter-contracts.js";
import {
  OPENCLAW_BRIDGE_API_KEY,
  OPENCLAW_BRIDGE_BASE_URL,
  OPENCLAW_BRIDGE_CONTROL_PATH,
  OPENCLAW_BRIDGE_DISPATCH_PATH,
  OPENCLAW_BRIDGE_SWEEP_PATH,
} from "./config.js";
import type {
  AdapterDispatchResult,
  DispatchEnvelope,
  ExecutionMaintenanceResult,
  NormalizedExecutionReport,
} from "./types.js";
import { generateEventId } from "./utils.js";

type JsonRecord = Record<string, unknown>;

function logAdapter(message: string, context: Record<string, string>): void {
  console.warn(`[openclaw-adapter] ${message}`, context);
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (OPENCLAW_BRIDGE_API_KEY) {
    headers.authorization = `Bearer ${OPENCLAW_BRIDGE_API_KEY}`;
  }
  return headers;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OpenClawExecutionAdapter implements ExecutionAdapter {
  readonly kind = "openclaw";

  enqueueRun(runId: string): void {
    logAdapter("run queued for external bridge-driven dispatch.", { runId });
  }

  notifyRunAction(runId: string, action: RunAction): void {
    void this.postControl({
      runId,
      nodeRunId: null,
      action,
    });
  }

  notifyNodeAction(runId: string, nodeRunId: string, action: NodeAction): void {
    void this.postControl({
      runId,
      nodeRunId,
      action,
    });
  }

  async dispatchNode(envelope: DispatchEnvelope): Promise<AdapterDispatchResult> {
    if (!OPENCLAW_BRIDGE_BASE_URL) {
      logAdapter("bridge base url is not configured; dispatch deferred.", {
        runId: envelope.run_id,
        nodeRunId: envelope.node_run_id,
      });
      return {
        dispatch_id: `disp_${generateEventId()}`,
        openclaw_task_id: null,
        openclaw_session_id: null,
        status: "deferred",
      };
    }

    const payload = buildOpenClawBridgeDispatchRequest(envelope);
    const response = await fetch(`${OPENCLAW_BRIDGE_BASE_URL}${OPENCLAW_BRIDGE_DISPATCH_PATH}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenClaw bridge dispatch failed (${response.status}): ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!isJsonRecord(data)) {
      throw new Error("OpenClaw bridge dispatch returned an invalid payload.");
    }

    return {
      dispatch_id: asString(data.dispatch_id) || `disp_${generateEventId()}`,
      openclaw_task_id: asString(data.openclaw_task_id),
      openclaw_session_id: asString(data.openclaw_session_id),
      status:
        data.status === "accepted" || data.status === "rejected" || data.status === "deferred"
          ? data.status
          : "accepted",
    };
  }

  async handleReport(_report: NormalizedExecutionReport): Promise<void> {
    logAdapter("report callback reached adapter; control-plane endpoint owns persistence.", {
      status: _report.status,
      runId: _report.run_id,
      nodeRunId: _report.node_run_id,
    });
  }

  async runMaintenance(action: "dispatch_sweep"): Promise<ExecutionMaintenanceResult> {
    if (action !== "dispatch_sweep") {
      return {
        action,
        adapter_kind: this.kind,
        supported: false,
        message: `Unsupported maintenance action: ${action}`,
        summary: null,
      };
    }

    if (!OPENCLAW_BRIDGE_BASE_URL) {
      return {
        action,
        adapter_kind: this.kind,
        supported: false,
        message: "OpenClaw bridge base url is not configured.",
        summary: null,
      };
    }

    const response = await fetch(`${OPENCLAW_BRIDGE_BASE_URL}${OPENCLAW_BRIDGE_SWEEP_PATH}`, {
      method: "POST",
      headers: buildHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenClaw bridge maintenance failed (${response.status}): ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!isJsonRecord(data)) {
      throw new Error("OpenClaw bridge maintenance returned an invalid payload.");
    }

    return {
      action,
      adapter_kind: this.kind,
      supported: true,
      message: null,
      summary: {
        scanned:
          typeof data.scanned === "number" && Number.isFinite(data.scanned) ? data.scanned : 0,
        normalized:
          typeof data.normalized === "number" && Number.isFinite(data.normalized)
            ? data.normalized
            : 0,
        resumed:
          typeof data.resumed === "number" && Number.isFinite(data.resumed) ? data.resumed : 0,
        aligned:
          typeof data.aligned === "number" && Number.isFinite(data.aligned) ? data.aligned : 0,
        finalized:
          typeof data.finalized === "number" && Number.isFinite(data.finalized)
            ? data.finalized
            : 0,
      },
    };
  }

  private async postControl(input: {
    runId: string;
    nodeRunId: string | null;
    action: "pause" | "resume" | "cancel" | "retry" | "skip";
  }): Promise<void> {
    if (!OPENCLAW_BRIDGE_BASE_URL) {
      logAdapter("bridge base url is not configured; control message skipped.", {
        runId: input.runId,
        nodeRunId: input.nodeRunId || "",
        action: input.action,
      });
      return;
    }

    try {
      const payload = buildOpenClawBridgeControlRequest({
        runId: input.runId,
        nodeRunId: input.nodeRunId,
        action: input.action,
      });
      const response = await fetch(
        `${OPENCLAW_BRIDGE_BASE_URL}${OPENCLAW_BRIDGE_CONTROL_PATH}`,
        {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || response.statusText);
      }
    } catch (error) {
      logAdapter("control message failed.", {
        runId: input.runId,
        nodeRunId: input.nodeRunId || "",
        action: input.action,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}
