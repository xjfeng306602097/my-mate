import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AnySchema, ValidateFunction } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import { SCHEMAS_ROOT } from "./config.js";

const require = createRequire(import.meta.url);
type AjvLike = {
  addSchema(schema: AnySchema): void;
  getSchema(schemaId: string): ValidateFunction | undefined;
};

type AjvConstructor = new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => AjvLike;

const Ajv2020 = require("ajv/dist/2020").default as AjvConstructor;
const addFormats = require("ajv-formats").default as FormatsPlugin;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

addFormats(ajv as never);

function loadJson(filePath: string): AnySchema {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AnySchema;
}

const schemaPaths = [
  path.join(SCHEMAS_ROOT, "common", "enums.schema.json"),
  path.join(SCHEMAS_ROOT, "common", "timestamps.schema.json"),
  path.join(SCHEMAS_ROOT, "common", "pagination.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "workflow-edge.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "workflow-node.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "workflow-template.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "run-plan.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "run-state.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "node-run.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "event.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "artifact.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "approval.schema.json"),
  path.join(SCHEMAS_ROOT, "workflow", "human-input.schema.json"),
  path.join(SCHEMAS_ROOT, "agent", "agent-profile.schema.json"),
  path.join(SCHEMAS_ROOT, "agent", "skill.schema.json"),
];

for (const schemaPath of schemaPaths) {
  ajv.addSchema(loadJson(schemaPath));
}

export function compileValidator(schemaId: string): ValidateFunction {
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new Error(`Schema not found: ${schemaId}`);
  }
  return validator;
}
