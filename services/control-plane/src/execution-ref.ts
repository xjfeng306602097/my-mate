import type { RuntimeDispatchResult } from "./runtime-dispatcher.js";
import type { ExecutionRef, RuntimeReportCallbackRequest } from "./types.js";

function normalizeProviderRefs(
  value: Record<string, unknown> | null | undefined,
): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  if (!value) {
    return next;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (key === "openclaw_task_id" || key === "openclaw_session_id") continue;
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
}): ExecutionRef {
  return {
    job_id: input?.job_id ?? null,
    worker_id: input?.worker_id ?? null,
    lease_id: input?.lease_id ?? null,
    target_kind: input?.target_kind ?? null,
    dispatch_id: input?.dispatch_id ?? null,
    provider_refs: { ...(input?.provider_refs || {}) },
  };
}

export function normalizeExecutionRef(value: unknown): ExecutionRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createEmptyExecutionRef();
  }

  const record = value as Record<string, unknown>;
  const rawProviderRefs = typeof record.provider_refs === "object" && record.provider_refs !== null
    ? (record.provider_refs as Record<string, unknown>)
    : null;
  const providerRefs = normalizeProviderRefs(rawProviderRefs);

  const legacyTaskId =
    typeof record.openclaw_task_id === "string"
      ? record.openclaw_task_id
      : record.openclaw_task_id === null
        ? null
        : typeof rawProviderRefs?.openclaw_task_id === "string" ? rawProviderRefs.openclaw_task_id : null;
  const legacySessionId =
    typeof record.openclaw_session_id === "string"
      ? record.openclaw_session_id
      : record.openclaw_session_id === null
        ? null
        : typeof rawProviderRefs?.openclaw_session_id === "string" ? rawProviderRefs.openclaw_session_id : null;

  return {
    job_id: typeof record.job_id === "string" ? record.job_id : null,
    worker_id: typeof record.worker_id === "string" ? record.worker_id : null,
    lease_id: typeof record.lease_id === "string" ? record.lease_id : null,
    target_kind:
      record.target_kind === "local" ||
      record.target_kind === "docker-worker" ||
      record.target_kind === "node-worker"
        ? record.target_kind
        : record.target_kind === "external-bridge"
          ? "docker-worker"
        : null,
    dispatch_id: typeof record.dispatch_id === "string" ? record.dispatch_id : null,
    provider_refs: {
      ...providerRefs,
      ...(legacyTaskId !== null && providerRefs.task_id === undefined
        ? { task_id: legacyTaskId }
        : {}),
      ...(legacySessionId !== null && providerRefs.session_id === undefined
        ? { session_id: legacySessionId }
        : {}),
    },
  };
}

export function createExecutionRefFromRawRef(
  rawRef: NonNullable<RuntimeReportCallbackRequest["raw_ref"]>,
  current?: ExecutionRef | null,
): ExecutionRef {
  const base = current ? normalizeExecutionRef(current) : createEmptyExecutionRef();
  return createExecutionRef({
    ...base,
    dispatch_id: rawRef.dispatch_id,
    provider_refs: {
      ...base.provider_refs,
      ...(rawRef.provider_refs || {}),
    },
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
      ...(result.compatibility.raw_ref.provider_refs || {}),
    },
  });
}
