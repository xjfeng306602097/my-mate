import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSchemaPayload,
  validateRequiredFields,
  type SchemaShape,
} from "@/lib/schema";

test("buildSchemaPayload trims strings and parses numeric fields", () => {
  const schema: SchemaShape = {
    properties: {
      title: { type: "string" },
      count: { type: "integer" },
      ratio: { type: "number" },
      notes: { type: "string", format: "textarea" },
      enabled: { type: "boolean" },
    },
  };

  const result = buildSchemaPayload(schema, {
    title: "  hello world  ",
    count: " 42 ",
    ratio: " 3.14 ",
    notes: "  keep me  ",
    enabled: true,
  });

  assert.deepEqual(result, {
    title: "hello world",
    count: 42,
    ratio: 3.14,
    notes: "keep me",
    enabled: true,
  });
});

test("buildSchemaPayload keeps invalid numeric input as raw trimmed string", () => {
  const schema: SchemaShape = {
    properties: {
      count: { type: "integer" },
      ratio: { type: "number" },
    },
  };

  const result = buildSchemaPayload(schema, {
    count: "abc",
    ratio: "1.2.3",
  });

  assert.deepEqual(result, {
    count: "abc",
    ratio: "1.2.3",
  });
});

test("validateRequiredFields returns the first missing required key", () => {
  const schema: SchemaShape = {
    required: ["title", "notes"],
    properties: {
      title: { type: "string" },
      notes: { type: "string" },
    },
  };

  assert.equal(
    validateRequiredFields(schema, {
      title: "done",
      notes: "   ",
    }),
    "notes",
  );
});

test("validateRequiredFields treats boolean required fields as present", () => {
  const schema: SchemaShape = {
    required: ["enabled"],
    properties: {
      enabled: { type: "boolean" },
    },
  };

  assert.equal(
    validateRequiredFields(schema, {
      enabled: false,
    }),
    null,
  );
});
