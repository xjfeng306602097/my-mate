import express from "express";
import type { Request, Response } from "express";
import { BRIDGE_API_KEY, BRIDGE_EXECUTION_MODE, PORT } from "./config.js";
import {
  createDispatch,
  applyControlAction,
  repairDispatch,
  sweepDispatchMaintenance,
} from "./bridge-runtime.js";
import { getDispatch, listDispatches } from "./dispatch-store.js";
import type { ControlRequest, DispatchRepairRequest, DispatchRequest } from "./types.js";
import { isPlainObject } from "./utils.js";

function getSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value || null;
}

function isAuthorized(req: Request): boolean {
  if (!BRIDGE_API_KEY) {
    return true;
  }
  return req.header("authorization") === `Bearer ${BRIDGE_API_KEY}`;
}

function isDispatchRequest(body: unknown): body is DispatchRequest {
  if (!isPlainObject(body)) {
    return false;
  }
  return (
    typeof body.run_id === "string" &&
    !!body.run_id.trim() &&
    typeof body.node_run_id === "string" &&
    !!body.node_run_id.trim() &&
    typeof body.node_id === "string" &&
    !!body.node_id.trim() &&
    typeof body.node_name === "string" &&
    !!body.node_name.trim() &&
    typeof body.callback === "object" &&
    body.callback !== null &&
    typeof (body.callback as { report_url?: unknown }).report_url === "string"
  );
}

function isControlRequest(body: unknown): body is ControlRequest {
  if (!isPlainObject(body)) {
    return false;
  }
  return (
    typeof body.run_id === "string" &&
    !!body.run_id.trim() &&
    typeof body.action === "string" &&
    !!body.action.trim()
  );
}

function isDispatchRepairRequest(body: unknown): body is DispatchRepairRequest {
  if (!isPlainObject(body)) {
    return false;
  }
  return typeof body.action === "string" && !!body.action.trim();
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      mode: BRIDGE_EXECUTION_MODE,
      port: PORT,
    });
  });

  app.get("/api/v1/dispatches", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    return res.json({
      items: listDispatches(),
    });
  });

  app.get("/api/v1/dispatches/:dispatchId", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    const dispatchId = getSingleParam(req.params.dispatchId);
    if (!dispatchId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "dispatchId is required.",
      });
    }

    const item = getDispatch(dispatchId);
    if (!item) {
      return res.status(404).json({
        code: "not_found",
        message: "Dispatch not found.",
      });
    }

    return res.json(item);
  });

  app.post("/api/v1/dispatches/sweep", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    void sweepDispatchMaintenance()
      .then((result) => {
        res.status(202).json(result);
      })
      .catch((error) => {
        res.status(500).json({
          code: "sweep_failed",
          message: error instanceof Error ? error.message : "Dispatch sweep failed.",
        });
      });
  });

  app.post("/api/v1/dispatches/:dispatchId/repair", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    const dispatchId = getSingleParam(req.params.dispatchId);
    if (!dispatchId) {
      return res.status(400).json({
        code: "invalid_request",
        message: "dispatchId is required.",
      });
    }

    if (!isDispatchRepairRequest(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "Repair payload is invalid.",
      });
    }

    void repairDispatch({
      dispatchId,
      action: req.body.action,
      reason: typeof req.body.reason === "string" ? req.body.reason : undefined,
    })
      .then((result) => {
        res.status(202).json(result);
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "DISPATCH_NOT_FOUND") {
          return res.status(404).json({
            code: "not_found",
            message: "Dispatch not found.",
          });
        }
        if (error instanceof Error && error.message === "DISPATCH_SESSION_KEY_MISSING") {
          return res.status(409).json({
            code: "session_key_missing",
            message: "Dispatch does not have a session key to normalize.",
          });
        }

        return res.status(500).json({
          code: "repair_failed",
          message: error instanceof Error ? error.message : "Repair action failed.",
        });
      });
  });

  app.post("/api/v1/dispatches", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    if (!isDispatchRequest(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "Dispatch payload is invalid.",
      });
    }

    void createDispatch(req.body)
      .then((result) => {
        res.status(202).json(result);
      })
      .catch((error) => {
        res.status(500).json({
          code: "dispatch_failed",
          message: error instanceof Error ? error.message : "Dispatch failed.",
        });
      });
  });

  app.post("/api/v1/controls", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({
        code: "unauthorized",
        message: "Invalid bridge API key.",
      });
    }

    if (!isControlRequest(req.body)) {
      return res.status(400).json({
        code: "invalid_request",
        message: "Control payload is invalid.",
      });
    }

    void applyControlAction({
      runId: req.body.run_id,
      nodeRunId: req.body.node_run_id,
      action: req.body.action,
    })
      .then((result) => {
        res.status(202).json(result);
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "DISPATCH_NOT_FOUND") {
          return res.status(404).json({
            code: "not_found",
            message: "Dispatch not found.",
          });
        }

        return res.status(500).json({
          code: "control_failed",
          message: error instanceof Error ? error.message : "Control action failed.",
        });
      });
  });

  return app;
}
