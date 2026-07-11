import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import type { AnySchema, ValidateFunction } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import type { ScorecardCheckDefinition, ScorecardCheckSelector } from "../../types.js";
import type { FindingSeverity, RunEvidenceSnapshot, ScorecardFinding } from "../types.js";

const require = createRequire(import.meta.url);
type AjvLike = { compile(schema: AnySchema): ValidateFunction };
type AjvConstructor = new (options?: { allErrors?: boolean; strict?: boolean }) => AjvLike;
const Ajv2020 = require("ajv/dist/2020").default as AjvConstructor;
const addFormats = require("ajv-formats").default as FormatsPlugin;

function finding(input: {
  check: ScorecardCheckDefinition;
  passed: boolean;
  summary: string;
  detail: string;
  evidenceRefs?: string[];
}): ScorecardFinding {
  const failureSeverity = input.check.severity || "error";
  return {
    check_id: `contract.${input.check.id}`,
    severity: input.passed ? "info" : failureSeverity as FindingSeverity,
    passed: input.passed,
    summary: input.summary,
    detail: input.detail,
    evidence_refs: [...new Set(input.evidenceRefs || [])],
  };
}

function selectedNodeRunIds(
  snapshot: RunEvidenceSnapshot,
  selector?: ScorecardCheckSelector,
): Set<string> | null {
  if (!selector || (!selector.node_id && !selector.node_run_id && !selector.work_package)) {
    return null;
  }
  return new Set(snapshot.effective_plan.compiled_nodes
    .filter((node) =>
      (!selector.node_id || node.node_id === selector.node_id) &&
      (!selector.node_run_id || node.node_run_id === selector.node_run_id) &&
      (!selector.work_package || node.work_package?.key === selector.work_package),
    )
    .map((node) => node.node_run_id));
}

function selected<T extends { node_run_id?: string | null }>(
  values: T[],
  nodeRunIds: Set<string> | null,
): T[] {
  return nodeRunIds === null
    ? values
    : values.filter((value) => Boolean(value.node_run_id && nodeRunIds.has(value.node_run_id)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  return typeof record.name === "string"
    ? record.name
    : typeof record.tool === "string"
      ? record.tool
      : null;
}

function resolvableUri(value: string): boolean {
  return /^(workspace|file|https?):\/\//.test(value);
}

function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)];
    const record = asRecord(current);
    return record ? record[segment] : undefined;
  }, value);
}

function assertionPasses(check: Extract<ScorecardCheckDefinition, { type: "deterministic_assertion" }>, value: unknown): boolean {
  if (check.operator === "equals") return isDeepStrictEqual(value, check.expected);
  if (check.operator === "contains") {
    if (typeof value === "string") return value.includes(String(check.expected ?? ""));
    if (Array.isArray(value)) return value.some((item) => isDeepStrictEqual(item, check.expected));
    return false;
  }
  if (check.operator === "regex") {
    try {
      return new RegExp(String(check.expected ?? "")).test(String(value ?? ""));
    } catch {
      return false;
    }
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return (check.min === undefined || value >= check.min) &&
    (check.max === undefined || value <= check.max);
}

export function evaluateDeterministicAssertion(
  snapshot: RunEvidenceSnapshot,
  check: Extract<ScorecardCheckDefinition, { type: "deterministic_assertion" }>,
): ScorecardFinding {
  const nodeRunIds = selectedNodeRunIds(snapshot, check.selector);
  const subjects: unknown[] = check.subject === "run"
    ? [snapshot.run]
    : check.subject === "route"
      ? [snapshot.route]
      : check.subject === "evidence"
        ? selected(snapshot.evidence, nodeRunIds)
        : check.subject === "artifact"
          ? selected(snapshot.artifacts, nodeRunIds)
          : selected(snapshot.handoffs, nodeRunIds);
  const values = subjects.map((subject) => readPath(subject, check.path));
  const checks = values.map((value) => assertionPasses(check, value));
  const passed = checks.length > 0 && (check.match === "all" ? checks.every(Boolean) : checks.some(Boolean));
  return finding({
    check,
    passed,
    summary: passed ? `Deterministic assertion ${check.id} passed.` : `Deterministic assertion ${check.id} failed.`,
    detail: `subject=${check.subject}; path=${check.path || "<root>"}; operator=${check.operator}; matched=${checks.filter(Boolean).length}/${checks.length}`,
    evidenceRefs: check.subject === "evidence"
      ? selected(snapshot.evidence, nodeRunIds).map((item) => `evidence:${item.evidence_id}`)
      : check.subject === "artifact"
        ? selected(snapshot.artifacts, nodeRunIds).map((item) => `artifact:${item.artifact_id}`)
        : check.subject === "handoff"
          ? selected(snapshot.handoffs, nodeRunIds).map((item) => `handoff:${item.handoff_id}`)
          : [`${check.subject}:${snapshot.run.run_id}`],
  });
}

export function evaluateDeclarativeChecks(
  snapshot: RunEvidenceSnapshot,
  checks: ScorecardCheckDefinition[],
): ScorecardFinding[] {
  return checks.filter((check) => check.type !== "deterministic_assertion" || check.quality !== true)
    .map((check): ScorecardFinding => {
      const nodeRunIds = selectedNodeRunIds(snapshot, check.selector);
      if (check.type === "required_evidence") {
        const evidence = selected(snapshot.evidence, nodeRunIds);
        const minimum = check.min_count || 1;
        const counts = Object.fromEntries(check.kinds.map((kind) => [
          kind,
          evidence.filter((item) => item.kind === kind).length,
        ]));
        const passed = Object.values(counts).every((count) => count >= minimum);
        return finding({
          check,
          passed,
          summary: passed ? "Required evidence kinds are present." : "Required evidence kinds are missing.",
          detail: `minimum=${minimum}; counts=${JSON.stringify(counts)}`,
          evidenceRefs: evidence.map((item) => `evidence:${item.evidence_id}`),
        });
      }
      if (check.type === "required_tool") {
        const calls = selected(snapshot.evidence, nodeRunIds).filter((item) => item.kind === "tool_call");
        const minimum = check.min_calls ?? 1;
        const counts = Object.fromEntries(check.names.map((name) => [
          name,
          calls.filter((item) => toolName(item.inline_payload) === name).length,
        ]));
        const passed = Object.values(counts).every((count) =>
          count >= minimum && (check.max_calls === undefined || count <= check.max_calls),
        );
        return finding({
          check,
          passed,
          summary: passed ? "Required tool call counts are satisfied." : "Required tool call counts are not satisfied.",
          detail: `minimum=${minimum}; maximum=${check.max_calls ?? "unbounded"}; counts=${JSON.stringify(counts)}`,
          evidenceRefs: calls.map((item) => `evidence:${item.evidence_id}`),
        });
      }
      if (check.type === "artifact_contract") {
        let pattern: RegExp | null = null;
        try {
          pattern = check.name_pattern ? new RegExp(check.name_pattern) : null;
        } catch {
          return finding({ check, passed: false, summary: "Artifact name pattern is invalid.", detail: check.name_pattern || "" });
        }
        const artifacts = selected(snapshot.artifacts, nodeRunIds).filter((artifact) =>
          (!check.artifact_type || artifact.type === check.artifact_type) &&
          (!check.mime_type || artifact.mime_type === check.mime_type) &&
          (!pattern || pattern.test(artifact.name)),
        );
        const minimum = check.min_count || 1;
        let invalidMetadata = 0;
        if (check.metadata_schema) {
          const ajv = new Ajv2020({ allErrors: true, strict: false });
          addFormats(ajv as never);
          try {
            const validate = ajv.compile(check.metadata_schema as AnySchema);
            invalidMetadata = artifacts.filter((artifact) => !validate(artifact)).length;
          } catch (error) {
            return finding({
              check,
              passed: false,
              summary: "Artifact metadata JSON Schema is invalid.",
              detail: error instanceof Error ? error.message : "Schema compilation failed.",
            });
          }
        }
        const passed = artifacts.length >= minimum &&
          invalidMetadata === 0 &&
          (!check.require_resolvable_uri || artifacts.every((artifact) => resolvableUri(artifact.storage_uri)));
        return finding({
          check,
          passed,
          summary: passed ? "Artifact contract is satisfied." : "Artifact contract is not satisfied.",
          detail: `matched=${artifacts.length}; minimum=${minimum}; invalid_metadata=${invalidMetadata}; resolvable_uri=${check.require_resolvable_uri === true}`,
          evidenceRefs: artifacts.map((item) => `artifact:${item.artifact_id}`),
        });
      }
      if (check.type === "handoff_schema") {
        const handoffs = selected(snapshot.handoffs, nodeRunIds);
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        addFormats(ajv as never);
        let validate: ValidateFunction;
        try {
          validate = ajv.compile(check.schema as AnySchema);
        } catch (error) {
          return finding({
            check,
            passed: false,
            summary: "Handoff JSON Schema is invalid.",
            detail: error instanceof Error ? error.message : "Schema compilation failed.",
          });
        }
        const invalid = handoffs.filter((handoff) => !validate(handoff.content));
        const minimum = check.min_count || 1;
        const passed = handoffs.length >= minimum && invalid.length === 0;
        return finding({
          check,
          passed,
          summary: passed ? "Handoff content satisfies its JSON Schema." : "Handoff content does not satisfy its JSON Schema.",
          detail: `matched=${handoffs.length}; minimum=${minimum}; invalid=${invalid.length}`,
          evidenceRefs: handoffs.map((item) => `handoff:${item.handoff_id}`),
        });
      }
      if (check.type === "test_category") {
        const evidence = selected(snapshot.evidence, nodeRunIds);
        const artifacts = selected(snapshot.artifacts, nodeRunIds);
        const observed = new Set<string>();
        for (const item of evidence) {
          const payload = asRecord(item.inline_payload);
          const categories = payload?.categories;
          if (typeof payload?.category === "string") observed.add(payload.category);
          if (typeof payload?.test_category === "string") observed.add(payload.test_category);
          if (Array.isArray(categories)) categories.forEach((category) => typeof category === "string" && observed.add(category));
        }
        for (const artifact of artifacts) {
          for (const category of check.categories) {
            if (`${artifact.type} ${artifact.name}`.toLowerCase().includes(category)) observed.add(category);
          }
        }
        const missing = check.categories.filter((category) => !observed.has(category));
        return finding({
          check,
          passed: missing.length === 0,
          summary: missing.length === 0 ? "Required test categories are present." : "Required test categories are missing.",
          detail: `observed=${[...observed].sort().join(",") || "none"}; missing=${missing.join(",") || "none"}`,
          evidenceRefs: [
            ...evidence.map((item) => `evidence:${item.evidence_id}`),
            ...artifacts.map((item) => `artifact:${item.artifact_id}`),
          ],
        });
      }
      return evaluateDeterministicAssertion(snapshot, check);
    });
}
