import { createRequire } from "node:module";
import type { ValidateFunction } from "ajv";

const require = createRequire(import.meta.url);
type AjvLike = { compile(schema: Record<string, unknown>): ValidateFunction };
type AjvConstructor = new (options?: { allErrors?: boolean; strict?: boolean; allowUnionTypes?: boolean }) => AjvLike;
const Ajv = require("ajv").default as AjvConstructor;

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

const CONTRACT_METADATA_KEYS = new Set([
  "expected_artifacts",
  "expected_outputs",
]);

function shorthandType(value: string): string | null {
  const match = value.toLowerCase().match(/\b(string|number|integer|boolean|object|array|null)\b/);
  return match?.[1] || null;
}

function normalizeSchemaValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const explicitSchema = keys.includes("type") || keys.includes("$schema") || keys.includes("$ref") ||
      (keys.includes("properties") && !!record.properties && typeof record.properties === "object");
    if (explicitSchema) return record;
    return {
      type: "object",
      properties: Object.fromEntries(Object.entries(record).map(([key, child]) => [key, normalizeSchemaValue(child)])),
      required: Object.keys(record),
      additionalProperties: true,
    };
  }
  if (typeof value === "string") {
    const type = shorthandType(value);
    return type ? { type } : {};
  }
  return {};
}

function executableContractValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const explicitSchema = keys.includes("type") || keys.includes("$schema") || keys.includes("$ref") ||
    (keys.includes("properties") && !!record.properties && typeof record.properties === "object");
  if (explicitSchema) return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !CONTRACT_METADATA_KEYS.has(key)));
}

export function expectedContractArtifacts(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [...new Set([record.expected_artifacts, record.expected_outputs]
    .flatMap((items) => Array.isArray(items) ? items : [])
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim()))];
}

export function normalizeContractSchema(value: unknown): Record<string, unknown> | null {
  const executable = executableContractValue(value);
  if (!executable || typeof executable !== "object" || Array.isArray(executable) || !Object.keys(executable as object).length) return null;
  return normalizeSchemaValue(executable);
}

export function compileContractSchema(value: unknown, label: string): ValidateFunction | null {
  const schema = normalizeContractSchema(value);
  if (!schema) return null;
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw Object.assign(new Error(`${label} is not a valid JSON Schema: ${error instanceof Error ? error.message : "invalid schema"}`), { code: "agent_contract_schema_invalid" });
  }
}

function withoutRequired(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRequired);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "required") continue;
    copy[key] = withoutRequired(child);
  }
  return copy;
}

export function assertContractValue(value: unknown, contract: unknown, label: string, partial = false): void {
  const schema = normalizeContractSchema(contract);
  if (!schema) return;
  const validator = compileContractSchema(partial ? withoutRequired(schema) : schema, label);
  if (!validator || validator(value)) return;
  const details = (validator.errors || []).slice(0, 8).map((error) => `${error.instancePath || "$"} ${error.message || "invalid"}`).join("; ");
  throw Object.assign(new Error(`${label} does not satisfy its contract: ${details}`), { code: "agent_contract_validation_failed", contract: label, validation_errors: validator.errors || [] });
}
