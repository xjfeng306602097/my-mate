import path from "node:path";
import { RUNTIME_WORKSPACES_DIR } from "../config.js";
import { slugify } from "../utils.js";
import {
  ensureSandboxWorkspace,
  finalizeSandboxWorkspace,
  type RuntimeWorkspaceChangeSet,
  type WorkspaceBaseline,
} from "./workspace-change-set.js";

function runWorkspaceSegment(runId: string): string {
  return slugify(runId).replace(/[^a-z0-9_.-]/g, "-").slice(0, 54) || "run";
}

export function runWorkspaceHostPath(runId: string): string {
  return path.resolve(RUNTIME_WORKSPACES_DIR, runWorkspaceSegment(runId), "project");
}

export function ensureRunWorkspace(input: {
  runId: string;
  sourceRoot: string;
}): WorkspaceBaseline {
  return ensureSandboxWorkspace({
    sourceRoot: input.sourceRoot,
    sandboxRoot: runWorkspaceHostPath(input.runId),
  });
}

export function finalizeRunWorkspace(input: {
  runId: string;
  nodeRunId: string;
  jobId: string;
}): RuntimeWorkspaceChangeSet | null {
  return finalizeSandboxWorkspace({
    runId: input.runId,
    nodeRunId: input.nodeRunId,
    jobId: input.jobId,
    sandboxRoot: runWorkspaceHostPath(input.runId),
  });
}
