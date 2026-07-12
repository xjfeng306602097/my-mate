import { isDeepStrictEqual } from "node:util";

export type EdgeOutcomeStatus = "completed" | "failed" | "cancelled" | "handoff";

export interface EdgeConditionContext {
  outcome: {
    status: EdgeOutcomeStatus;
  };
  handoff: {
    port: string;
    content: unknown;
    content_ref: string | null;
    summary: string | null;
  };
  error: Record<string, unknown> | null;
  source: {
    node_id: string;
    node_run_id: string;
    name: string;
    attempt: number;
  };
  run: {
    run_id: string;
    status: string;
  };
}

export interface EdgeConditionEvaluation {
  matched: boolean;
  valid: boolean;
  reason: string;
  observed_path: string | null;
  observed_value: unknown;
}

const SUCCESS_PORTS = new Set(["success", "completed", "complete", "done", "default"]);
const FAILURE_PORTS = new Set(["failure", "failed", "error", "rejected"]);
const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 8;
const MAX_CHILDREN = 32;

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeRoutingPort(value: string | null | undefined): string {
  return (value || "success").trim().toLowerCase();
}

export function isSuccessRoutingPort(value: string | null | undefined): boolean {
  return SUCCESS_PORTS.has(normalizeRoutingPort(value));
}

export function isFailureRoutingPort(value: string | null | undefined): boolean {
  return FAILURE_PORTS.has(normalizeRoutingPort(value));
}

export function routingPortsMatch(
  edgePortValue: string | null | undefined,
  handoffPortValue: string,
): boolean {
  const edgePort = normalizeRoutingPort(edgePortValue);
  const handoffPort = normalizeRoutingPort(handoffPortValue);
  return edgePort === handoffPort ||
    (SUCCESS_PORTS.has(edgePort) && SUCCESS_PORTS.has(handoffPort)) ||
    (FAILURE_PORTS.has(edgePort) && FAILURE_PORTS.has(handoffPort));
}

export function outcomeFromHandoffPort(port: string): EdgeOutcomeStatus {
  if (isFailureRoutingPort(port)) return "failed";
  if (isSuccessRoutingPort(port)) return "completed";
  return "handoff";
}

function invalid(reason: string): EdgeConditionEvaluation {
  return {
    matched: false,
    valid: false,
    reason,
    observed_path: null,
    observed_value: null,
  };
}

function resolvePath(
  context: EdgeConditionContext,
  path: string,
): { found: boolean; value: unknown } {
  const segments = path.split(".");
  if (
    !segments.length ||
    segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment)) ||
    segments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))
  ) {
    return { found: false, value: undefined };
  }
  let current: unknown = context;
  for (const segment of segments) {
    const currentRecord = record(current);
    if (!currentRecord || !Object.prototype.hasOwnProperty.call(currentRecord, segment)) {
      return { found: false, value: undefined };
    }
    current = currentRecord[segment];
  }
  return { found: true, value: current };
}

function comparePredicate(
  op: string,
  observed: { found: boolean; value: unknown },
  expected: unknown,
): boolean | null {
  if (op === "exists") return observed.found;
  if (op === "not_exists") return !observed.found;
  if (!observed.found) return false;
  if (op === "eq") return isDeepStrictEqual(observed.value, expected);
  if (op === "neq") return !isDeepStrictEqual(observed.value, expected);
  if (op === "in" || op === "not_in") {
    if (!Array.isArray(expected)) return null;
    const included = expected.some((candidate) => isDeepStrictEqual(candidate, observed.value));
    return op === "in" ? included : !included;
  }
  if (op === "contains") {
    if (typeof observed.value === "string" && typeof expected === "string") {
      return observed.value.includes(expected);
    }
    if (Array.isArray(observed.value)) {
      return observed.value.some((candidate) => isDeepStrictEqual(candidate, expected));
    }
    return null;
  }
  if (["gt", "gte", "lt", "lte"].includes(op)) {
    if (typeof observed.value !== "number" || typeof expected !== "number") return null;
    if (op === "gt") return observed.value > expected;
    if (op === "gte") return observed.value >= expected;
    if (op === "lt") return observed.value < expected;
    return observed.value <= expected;
  }
  return null;
}

function evaluate(
  condition: Record<string, unknown>,
  context: EdgeConditionContext,
  depth: number,
): EdgeConditionEvaluation {
  if (depth > MAX_DEPTH) return invalid("condition_depth_exceeded");

  if ("kind" in condition) {
    if (typeof condition.kind !== "string" || !hasOnlyKeys(condition, ["kind"])) {
      return invalid("invalid_condition_kind_shape");
    }
    const kind = condition.kind.trim().toLowerCase();
    if (kind === "always") {
      return { matched: true, valid: true, reason: "always", observed_path: "outcome.status", observed_value: context.outcome.status };
    }
    if (kind === "on_success" || kind === "on_failure") {
      const expected = kind === "on_success" ? "completed" : "failed";
      return {
        matched: context.outcome.status === expected,
        valid: true,
        reason: kind,
        observed_path: "outcome.status",
        observed_value: context.outcome.status,
      };
    }
    return invalid("unknown_condition_kind");
  }

  const compoundKeys = ["all", "any", "not"].filter((key) => key in condition);
  if (compoundKeys.length > 1) return invalid("ambiguous_compound_condition");
  if (compoundKeys[0] === "not") {
    if (!hasOnlyKeys(condition, ["not"])) return invalid("invalid_not_condition_shape");
    const child = record(condition.not);
    if (!child) return invalid("invalid_not_condition");
    const result = evaluate(child, context, depth + 1);
    return result.valid
      ? { ...result, matched: !result.matched, reason: `not:${result.reason}` }
      : result;
  }
  if (compoundKeys[0] === "all" || compoundKeys[0] === "any") {
    const mode = compoundKeys[0];
    if (!hasOnlyKeys(condition, [mode])) return invalid(`invalid_${mode}_condition_shape`);
    const children = condition[mode];
    if (!Array.isArray(children) || children.length === 0 || children.length > MAX_CHILDREN) {
      return invalid(`invalid_${mode}_condition`);
    }
    const results = children.map((child) => {
      const childRecord = record(child);
      return childRecord ? evaluate(childRecord, context, depth + 1) : invalid("invalid_child_condition");
    });
    if (results.some((result) => !result.valid)) {
      return invalid(`${mode}_contains_invalid_condition`);
    }
    return {
      matched: mode === "all"
        ? results.every((result) => result.matched)
        : results.some((result) => result.matched),
      valid: true,
      reason: mode,
      observed_path: null,
      observed_value: null,
    };
  }

  if (typeof condition.path !== "string" || typeof condition.op !== "string") {
    return invalid("invalid_predicate_shape");
  }
  if (!hasOnlyKeys(condition, ["path", "op", "value"])) {
    return invalid("invalid_predicate_shape");
  }
  const path = condition.path.trim();
  const op = condition.op.trim().toLowerCase();
  const observed = resolvePath(context, path);
  const matched = comparePredicate(op, observed, condition.value);
  if (matched === null) return invalid("invalid_predicate_operands");
  return {
    matched,
    valid: true,
    reason: `predicate:${op}`,
    observed_path: path,
    observed_value: observed.found ? observed.value : null,
  };
}

export function evaluateEdgeCondition(
  condition: Record<string, unknown> | null,
  context: EdgeConditionContext,
): EdgeConditionEvaluation {
  if (!condition) {
    return {
      matched: context.outcome.status !== "failed",
      valid: true,
      reason: context.outcome.status === "failed" ? "default_on_success" : "unconditional",
      observed_path: "outcome.status",
      observed_value: context.outcome.status,
    };
  }
  return evaluate(condition, context, 0);
}
