export type SchemaField = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  format?: string;
  multiline?: boolean;
};

export type SchemaShape = {
  properties?: Record<string, SchemaField>;
  required?: string[];
};

export type SchemaValue = string | boolean;

export function buildSchemaPayload(
  schema: SchemaShape,
  value: Record<string, SchemaValue>,
): Record<string, unknown> {
  const properties = schema.properties || {};
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(properties)) {
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === "") {
      continue;
    }

    if (field.type === "boolean") {
      result[key] = rawValue === true;
      continue;
    }

    if (typeof rawValue !== "string") {
      result[key] = rawValue;
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    if (field.type === "number" || field.type === "integer") {
      const parsed = field.type === "integer" ? Number.parseInt(trimmed, 10) : Number(trimmed);
      result[key] = Number.isNaN(parsed) ? trimmed : parsed;
      continue;
    }

    result[key] = trimmed;
  }

  return result;
}

export function validateRequiredFields(
  schema: SchemaShape,
  value: Record<string, SchemaValue>,
): string | null {
  for (const key of schema.required || []) {
    const rawValue = value[key];
    if (typeof rawValue === "boolean") {
      continue;
    }
    if (!(rawValue || "").trim()) {
      return key;
    }
  }
  return null;
}
