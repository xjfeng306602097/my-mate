import { LifecycleStatusError, LifecycleTransitionError } from "@my-mate/shared-types/domain-lifecycle";

export const DOMAIN_ERROR_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type DomainErrorSeverity = (typeof DOMAIN_ERROR_SEVERITIES)[number];

export interface DomainErrorOptions {
  code: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
  severity: DomainErrorSeverity;
  remediation: string;
  domain: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface DomainErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  severity: DomainErrorSeverity;
  remediation: string;
  domain: string;
  details?: Record<string, unknown>;
}

export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly severity: DomainErrorSeverity;
  readonly remediation: string;
  readonly domain: string;
  readonly details?: Record<string, unknown>;

  constructor(options: DomainErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DomainError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable;
    this.severity = options.severity;
    this.remediation = options.remediation;
    this.domain = options.domain;
    this.details = options.details;
  }
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  statusCode?: unknown;
  httpStatus?: unknown;
  retryable?: unknown;
  severity?: unknown;
  remediation?: unknown;
  domain?: unknown;
  details?: unknown;
  schema_label?: unknown;
  validation_errors?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? error as ErrorLike : {};
}

function errorCode(error: unknown, fallback: string): string {
  const value = asErrorLike(error).code;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const value = asErrorLike(error).message;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function catalogFor(code: string): Pick<DomainErrorOptions, "httpStatus" | "retryable" | "severity" | "remediation" | "domain"> {
  if (code === "invalid_lifecycle_transition") {
    return { httpStatus: 409, retryable: false, severity: "error", remediation: "Reload the latest state and apply an action allowed by the current lifecycle state.", domain: "lifecycle" };
  }
  if (code === "invalid_lifecycle_status") {
    return { httpStatus: 500, retryable: false, severity: "critical", remediation: "Repair or restore the persisted record before processing it again.", domain: "lifecycle" };
  }
  if (code === "schema_validation_failed") {
    return { httpStatus: 422, retryable: false, severity: "error", remediation: "Correct the fields identified in details.validation_errors and submit the record again.", domain: "schema" };
  }
  if (code.startsWith("runtime_aggregate_")) {
    return { httpStatus: 409, retryable: false, severity: "critical", remediation: "Restore the Run, RunPlan, and NodeRun aggregate from one consistent checkpoint before retrying.", domain: "runtime" };
  }
  if (code.startsWith("agent_dag_") || code.startsWith("agent_task_") || code.startsWith("agent_run_")) {
    const notFound = code.endsWith("_not_found");
    return { httpStatus: notFound ? 404 : 409, retryable: false, severity: "error", remediation: notFound ? "Refresh the Agent DAG and select an existing resource." : "Refresh the DAG state, resolve its blocking condition, and retry the permitted action.", domain: "orchestration" };
  }
  if (code === "not_found") {
    return { httpStatus: 404, retryable: false, severity: "warning", remediation: "Refresh the current view and select an existing resource.", domain: "control-plane" };
  }
  if (code === "permission_denied" || code === "unauthorized") {
    return { httpStatus: code === "unauthorized" ? 401 : 403, retryable: false, severity: "warning", remediation: "Verify the active identity, workspace, and required permission before retrying.", domain: "security" };
  }
  if (/network|timeout|temporar|unavailable/u.test(code)) {
    return { httpStatus: 503, retryable: true, severity: "warning", remediation: "Check the provider connection and retry after the configured backoff.", domain: "integration" };
  }
  return { httpStatus: 500, retryable: false, severity: "critical", remediation: "Inspect the correlated server logs and persisted state before retrying.", domain: "control-plane" };
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function toDomainError(
  error: unknown,
  fallback: Partial<DomainErrorOptions> & Pick<DomainErrorOptions, "code" | "message"> = {
    code: "internal_error",
    message: "The Control Plane could not complete the request.",
  },
): DomainError {
  if (isDomainError(error)) return error;
  const source = asErrorLike(error);
  const sourceCode = typeof source.code === "string" && source.code.trim() ? source.code : null;
  const code = errorCode(error, fallback.code);
  const catalog = catalogFor(code);
  const useFallbackPolicy = sourceCode === null || sourceCode === fallback.code;
  const lifecycleDetails = error instanceof LifecycleTransitionError
    ? { lifecycle: error.lifecycle, from: error.from, to: error.to, recovery: error.recovery }
    : error instanceof LifecycleStatusError
      ? { lifecycle: error.lifecycle, value: error.value }
    : undefined;
  const schemaDetails = code === "schema_validation_failed"
    ? { schema_label: source.schema_label, validation_errors: source.validation_errors }
    : undefined;
  const sourceDetails = source.details && typeof source.details === "object" && !Array.isArray(source.details)
    ? source.details as Record<string, unknown>
    : undefined;
  const status = Number(source.httpStatus ?? source.statusCode ?? (useFallbackPolicy ? fallback.httpStatus : undefined) ?? catalog.httpStatus);
  const severity = DOMAIN_ERROR_SEVERITIES.includes(source.severity as DomainErrorSeverity)
    ? source.severity as DomainErrorSeverity
    : (useFallbackPolicy ? fallback.severity : undefined) ?? catalog.severity;
  return new DomainError({
    code,
    message: errorMessage(error, fallback.message),
    httpStatus: Number.isInteger(status) && status >= 400 && status <= 599 ? status : catalog.httpStatus,
    retryable: typeof source.retryable === "boolean" ? source.retryable : (useFallbackPolicy ? fallback.retryable : undefined) ?? catalog.retryable,
    severity,
    remediation: typeof source.remediation === "string" ? source.remediation : (useFallbackPolicy ? fallback.remediation : undefined) ?? catalog.remediation,
    domain: typeof source.domain === "string" ? source.domain : (useFallbackPolicy ? fallback.domain : undefined) ?? catalog.domain,
    details: (useFallbackPolicy ? fallback.details : undefined) ?? sourceDetails ?? lifecycleDetails ?? schemaDetails,
    cause: error,
  });
}

export function domainErrorResponse(error: unknown, fallback?: Parameters<typeof toDomainError>[1]): {
  status: number;
  body: DomainErrorBody;
} {
  const normalized = toDomainError(error, fallback);
  return {
    status: normalized.httpStatus,
    body: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      severity: normalized.severity,
      remediation: normalized.remediation,
      domain: normalized.domain,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  };
}
