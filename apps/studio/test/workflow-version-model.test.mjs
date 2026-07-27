import test from "node:test";
import assert from "node:assert/strict";
import {
  currentPublishedWorkflowTemplates,
  groupWorkflowFamilies,
  visibleWorkflowTemplates,
  workflowDisplayStatus,
  workflowFamilyForTemplate,
} from "../src/workflow-version-model.js";

function workflow(overrides = {}) {
  return {
    template_id: "delivery",
    version: 1,
    name: "Delivery",
    status: "published",
    updated_at: "2026-07-01T00:00:00.000Z",
    metadata: { versioning: { family_id: "delivery", generation: 1 } },
    ...overrides,
  };
}

test("workflow families expose one row while retaining published history", () => {
  const templates = [
    workflow(),
    workflow({ template_id: "delivery-v2", version: 2, status: "published", updated_at: "2026-07-02T00:00:00.000Z", metadata: { versioning: { family_id: "delivery", generation: 2 } } }),
    workflow({ template_id: "delivery-v3", version: 3, status: "draft", updated_at: "2026-07-03T00:00:00.000Z", metadata: { versioning: { family_id: "delivery", generation: 3 } } }),
  ];

  const families = groupWorkflowFamilies(templates);
  assert.equal(families.length, 1);
  assert.equal(families[0].displayTemplate.template_id, "delivery-v3");
  assert.equal(families[0].published.template_id, "delivery-v2");
  assert.equal(workflowDisplayStatus(families[0]), "Unpublished changes");
  assert.deepEqual(visibleWorkflowTemplates(templates).map((item) => item.template_id), ["delivery-v3"]);
  assert.deepEqual(currentPublishedWorkflowTemplates(templates).map((item) => item.template_id), ["delivery-v2"]);
  assert.equal(workflowFamilyForTemplate(templates, "delivery").familyId, "delivery");
});

test("independent derived workflows remain separate library objects", () => {
  const templates = [
    workflow(),
    workflow({ template_id: "delivery-variant", name: "Delivery Variant", status: "draft", metadata: { versioning: { family_id: "delivery-variant", generation: 1 } } }),
  ];
  assert.equal(groupWorkflowFamilies(templates).length, 2);
});
