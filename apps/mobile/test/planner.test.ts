import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyWarning,
  formatWarningSummary,
  formatWarnings,
  groupValidation,
  groupWarnings,
} from "@/lib/planner";
import type { PlannerValidationResult } from "@/lib/types";

test("classifyWarning categorizes key warning families", () => {
  assert.equal(classifyWarning("Missing required input: account_id"), "required_input");
  assert.equal(classifyWarning("Unknown skill: web.search"), "registry");
  assert.equal(classifyWarning("No terminal node found in graph"), "graph");
  assert.equal(classifyWarning("Something unexpected"), "other");
});

test("groupWarnings buckets warnings and drops empty groups", () => {
  const groups = groupWarnings([
    "Missing required input: account_id",
    "Unknown skill: web.search",
    "No terminal node found in graph",
    "Fallback warning",
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      key: group.key,
      count: group.items.length,
    })),
    [
      { key: "required_input", count: 1 },
      { key: "registry", count: 1 },
      { key: "graph", count: 1 },
      { key: "other", count: 1 },
    ],
  );
});

test("groupValidation prefers structured detail categories when present", () => {
  const validation: PlannerValidationResult = {
    passed: false,
    warnings: ["flat warning should be ignored when details exist"],
    details: [
      {
        code: "missing_required_input",
        category: "required_input",
        message: "Missing required input: owner",
        field: "owner",
        node_id: null,
        node_name: null,
        agent_profile_id: null,
        skill_id: null,
      },
      {
        code: "unknown_skill",
        category: "registry",
        message: "Unknown skill: web.search",
        field: null,
        node_id: "node_1",
        node_name: "Planner",
        agent_profile_id: null,
        skill_id: "web.search",
      },
    ],
  };

  const groups = groupValidation(validation);
  assert.deepEqual(
    groups.map((group) => ({
      key: group.key,
      items: group.items,
    })),
    [
      { key: "required_input", items: ["Missing required input: owner"] },
      { key: "registry", items: ["Unknown skill: web.search"] },
    ],
  );
});

test("formatWarnings limits long warning lists", () => {
  const text = formatWarnings(["one", "two", "three"], 2);
  assert.equal(text, "- one\n- two\n- 1 more warning(s)");
});

test("formatWarningSummary returns grouped counts", () => {
  const text = formatWarningSummary([
    "Missing required input: owner",
    "Unknown skill: web.search",
    "Unknown skill: crm.write",
  ]);

  assert.equal(text, "Required input: 1\nRegistry binding: 2");
});
