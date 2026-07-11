import type { RuntimeDispatchResult } from "./runtime-dispatcher.js";
import type { ExecutionRef, OpenClawReportCallbackRequest } from "./types.js";

function normalizeProviderRefs(
  value: Record<string, unknown> | null | undefined,
): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  if (!value) {
    return next;
  }
  for (const [key, raw] of Object.entries(value)) {
    next[key] = typeof raw === "string" ? raw : raw === null ? null : null;
  }
  return next;
}

export function createEmptyExecutionRef(): ExecutionRef {
  return createExecutionRef();
}

export function createExecutionRef(input?: {
  job_id?: string | null;
  worker_id?: string | null;
  lease_id?: string | null;
  target_kind?: ExecutionRef["target_kind"];
  dispatch_id?: string | null;
  provider_refs?: Record<string, string | null>;
  openclaw_task_id?: string | null;
  openclaw_session_id?: string | null;
}): ExecutionRef {
  const providerRefs = {
    ...(input?.provider_refs || {}),
  };
  const openclawTaskId =
    input?.openclaw_task_id !== undefined
      ? input.openclaw_task_id
      : providerRefs.openclaw_task_id ?? null;
  const openclawSessionId =
    input?.openclaw_session_id !== undefined
      ? input.openclaw_session_id
      : providerRefs.openclaw_session_id ?? null;

  return {
    job_id: input?.job_id ?? null,
    worker_id: input?.worker_id ?? null,
    lease_id: input?.lease_id ?? null,
    target_kind: input?.target_kind ?? null,
    dispatch_id: input?.dispatch_id ?? null,
    provider_refs: {
      ...providerRefs,
      openclaw_task_id: openclawTaskId,
      openclaw_session_id: openclawSessionId,
    },
    openclaw_task_id: openclawTaskId,
    openclaw_session_id: openclawSessionId,
  };
}

export function normalizeExecutionRef(value: unknown): ExecutionRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createEmptyExecutionRef();
  }

  const record = value as Record<string, unknown>;
  const providerRefs = normalizeProviderRefs(
    typeof record.provider_refs === "object" && record.provider_refs !== null
      ? (record.provider_refs as Record<string, unknown>)
      : null,
  );

  const openclawTaskId =
    typeof record.openclaw_task_id === "string"
      ? record.openclaw_task_id
      : record.openclaw_task_id === null
        ? null
        : providerRefs.openclaw_task_id ?? null;
  const openclawSessionId =
    typeof record.openclaw_session_id === "string"
      ? record.openclaw_session_id
      : record.openclaw_session_id === null
        ? null
        : providerRefs.openclaw_session_id ?? null;

  return {
    job_id: typeof record.job_id === "string" ? record.job_id : null,
    worker_id: typeof record.worker_id === "string" ? record.worker_id : null,
    lease_id: typeof record.lease_id === "string" ? record.lease_id : null,
    target_kind:
      record.target_kind === "local" ||
      record.target_kind === "external-bridge" ||
      record.target_kind === "docker-worker" ||
      record.target_kind === "node-worker"
        ? record.target_kind
        : null,
    dispatch_id: typeof record.dispatch_id === "string" ? record.dispatch_id : null,
    provider_refs: {
      ...providerRefs,
      openclaw_task_id: openclawTaskId,
      openclaw_session_id: openclawSessionId,
    },
    openclaw_task_id: openclawTaskId,
    openclaw_session_id: openclawSessionId,
  };
}

export function createExecutionRefFromRawRef(
  rawRef: NonNullable<OpenClawReportCallbackRequest["raw_ref"]>,
  current?: ExecutionRef | null,
): ExecutionRef {
  const base = current ? normalizeExecutionRef(current) : createEmptyExecutionRef();
  return createExecutionRef({
    ...base,
    dispatch_id: rawRef.dispatch_id,
    provider_refs: {
      ...base.provider_refs,
      openclaw_task_id: rawRef.openclaw_task_id,
      openclaw_session_id: rawRef.openclaw_session_id,
    },
    openclaw_task_id: rawRef.openclaw_task_id,
    openclaw_session_id: rawRef.openclaw_session_id,
  });
}

export function createExecutionRefFromRuntimeDispatch(
  result: RuntimeDispatchResult,
): ExecutionRef {
  return createExecutionRef({
    job_id: result.job.job_id,
    worker_id: result.worker_id,
    lease_id: result.lease_id,
    target_kind: result.target_kind,
    dispatch_id: result.dispatch_id,
    provider_refs: {
      openclaw_task_id: result.compatibility.raw_ref.openclaw_task_id,
      openclaw_session_id: result.compatibility.raw_ref.openclaw_session_id,
    },
    openclaw_task_id: result.compatibility.raw_ref.openclaw_task_id,
    openclaw_session_id: result.compatibility.raw_ref.openclaw_session_id,
  });
}
