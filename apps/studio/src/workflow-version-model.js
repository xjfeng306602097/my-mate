function versioningOf(template) {
  return template?.metadata?.versioning && typeof template.metadata.versioning === "object"
    ? template.metadata.versioning
    : {};
}

export function workflowFamilyId(template) {
  return versioningOf(template).family_id || template?.template_id || "";
}

function generationOf(template) {
  const generation = Number(versioningOf(template).generation);
  return Number.isFinite(generation) ? generation : Number(template?.version || 0);
}

function compareNewest(left, right) {
  const generationDelta = generationOf(right) - generationOf(left);
  if (generationDelta) return generationDelta;
  const versionDelta = Number(right?.version || 0) - Number(left?.version || 0);
  if (versionDelta) return versionDelta;
  return String(right?.updated_at || "").localeCompare(String(left?.updated_at || ""));
}

export function groupWorkflowFamilies(templates = []) {
  const grouped = new Map();
  for (const template of templates) {
    const familyId = workflowFamilyId(template);
    if (!familyId) continue;
    const items = grouped.get(familyId) || [];
    items.push(template);
    grouped.set(familyId, items);
  }

  return [...grouped.entries()]
    .map(([familyId, familyItems]) => {
      const items = [...familyItems].sort(compareNewest);
      const draft = items.find((item) => item.status === "draft") || null;
      const published = items.find((item) => item.status === "published") || null;
      const displayTemplate = draft || published || items[0] || null;
      return {
        familyId,
        items,
        draft,
        published,
        displayTemplate,
        hasUnpublishedChanges: Boolean(draft && published),
        updatedAt: displayTemplate?.updated_at || "",
      };
    })
    .filter((family) => family.displayTemplate)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export function visibleWorkflowTemplates(templates = []) {
  return groupWorkflowFamilies(templates).map((family) => family.displayTemplate);
}

export function currentPublishedWorkflowTemplates(templates = []) {
  return groupWorkflowFamilies(templates)
    .map((family) => family.published)
    .filter(Boolean);
}

export function workflowFamilyForTemplate(templates = [], templateId = "") {
  if (!templateId) return null;
  return groupWorkflowFamilies(templates).find((family) =>
    family.items.some((item) => item.template_id === templateId),
  ) || null;
}

export function workflowDisplayStatus(family) {
  if (!family) return "Workflow";
  if (family.hasUnpublishedChanges) return "Unpublished changes";
  if (family.draft) return "Draft";
  if (family.published) return "Published";
  return "Archived";
}
